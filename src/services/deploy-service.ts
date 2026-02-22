import type { DeployRequest, DeployResponse, ErrorResponse, ErrorCode, ServiceConfig } from "../types";
import { gitManager } from "./git-manager";
import { portManager } from "./port-manager";
import { pm2Manager } from "./pm2-manager";
import { nginxManager } from "./nginx-manager";
import { repoManager } from "./repo-manager";
import { exec } from "../utils/exec";
import { topologicalSort, prepareSmartCommand, buildEnvVars } from "../utils/deploy-helpers";
import { join } from "path";

interface DeployContext {
  repo: string;
  branch: string;
  deploymentId: string;
  commit: string;
  isNewWorktree: boolean;
  startedProcesses: string[];
  allocatedPorts: { deploymentId: string; service: string }[];
}

export class DeployService {
  async deploy(request: DeployRequest): Promise<DeployResponse | ErrorResponse> {
    const startTime = Date.now();
    const deploymentId = gitManager.getDeploymentId(request.branch, request.repo);

    const ctx: DeployContext = {
      repo: request.repo,
      branch: request.branch,
      deploymentId,
      commit: request.commit ?? "",
      isNewWorktree: false,
      startedProcesses: [],
      allocatedPorts: [],
    };

    try {
      if (!repoManager.exists(request.repo)) {
        throw { code: "REPO_NOT_FOUND", message: `Repo '${request.repo}' does not exist. Create it first via POST /repos.`, step: 0 };
      }

      await this.setupWorktree(ctx, request);
      const orderedServices = topologicalSort(request.services);
      const deployedServices: Record<string, { port: number; url: string }> = {};

      for (const serviceName of orderedServices) {
        const result = await this.deploySingleService(
          ctx,
          serviceName,
          request.services[serviceName],
          request.links?.[serviceName] ?? {},
          request.env?.[serviceName] ?? {},
        );
        deployedServices[serviceName] = result;
      }

      await this.setupNginx(ctx, deployedServices);

      return {
        success: true,
        branch: ctx.branch,
        commit: ctx.commit,
        services: deployedServices,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      await this.rollback(ctx);
      return this.buildError(error.code ?? "DEPLOY_ERROR", error.message, error.logs, error.step, error.service, Date.now() - startTime);
    }
  }

  private async deploySingleService(
    ctx: DeployContext,
    serviceName: string,
    config: ServiceConfig,
    links: Record<string, string>,
    extraEnv: Record<string, string>,
  ): Promise<{ port: number; url: string }> {
    const worktreePath = gitManager.getWorktreePath(ctx.branch, ctx.repo);
    const servicePath = config.root ? join(worktreePath, config.root) : worktreePath;

    const port = await portManager.allocate(ctx.deploymentId, serviceName);
    ctx.allocatedPorts.push({ deploymentId: ctx.deploymentId, service: serviceName });

    const smartCommand = prepareSmartCommand(config.start || "bun run start", port);
    const env = {
      ...buildEnvVars(extraEnv, links),
      PORT: port.toString(),
      HOST: "0.0.0.0",
    };

    await this.runCommand(config.install || "bun install", servicePath, "INSTALL_ERROR", serviceName, 2);
    if (config.build) {
      await this.runCommand(config.build, servicePath, "BUILD_ERROR", serviceName, 3);
    }

    try {
      const processName = await pm2Manager.start(serviceName, ctx.deploymentId, port, smartCommand, servicePath, env);
      ctx.startedProcesses.push(processName);
    } catch (error: any) {
      throw { code: "PROCESS_ERROR", message: error.message, service: serviceName, step: 4 };
    }

    const safeBranch = ctx.branch.replace(/\//g, "-").toLowerCase();
    return { port, url: `/${ctx.repo}/${safeBranch}${serviceName !== "web" ? `/${serviceName}` : ""}` };
  }

  async listDeployments(repo?: string) {
    const repos = repo ? [repo] : repoManager.list().map((r) => r.name);
    const processes = await pm2Manager.list();
    const ports = portManager.getAll();

    const results = [];
    for (const r of repos) {
      const branches = await gitManager.listWorktrees(r);
      for (const branch of branches) {
        const deploymentId = gitManager.getDeploymentId(branch, r);
        results.push({
          repo: r,
          branch,
          deploymentId,
          services: ports[deploymentId] ?? {},
          processes: processes.filter((p) => p.name.includes(`-${deploymentId}-`)),
        });
      }
    }
    return results;
  }

  async removeDeployment(branch: string, repo: string): Promise<void> {
    const deploymentId = gitManager.getDeploymentId(branch, repo);
    await pm2Manager.deleteByBranch(deploymentId);
    await gitManager.removeWorktree(branch, repo);
    portManager.release(deploymentId);
    await nginxManager.removeConfig(deploymentId);
    await nginxManager.reload();
  }

  private async setupNginx(ctx: DeployContext, services: Record<string, { port: number; url: string }>): Promise<void> {
    const routes = Object.entries(services).map(([service, { port }]) => ({ service, port }));
    await nginxManager.writeConfig(ctx.deploymentId, ctx.repo, ctx.branch, routes);
    await nginxManager.reload();
  }

  private async rollback(ctx: DeployContext): Promise<void> {
    for (const processName of ctx.startedProcesses) {
      await pm2Manager.delete(processName).catch(() => {});
    }
    if (ctx.isNewWorktree) {
      await gitManager.removeWorktree(ctx.branch, ctx.repo).catch(() => {});
    }
    await nginxManager.removeConfig(ctx.deploymentId).catch(() => {});
    await nginxManager.reload().catch(() => {});
  }

  private async setupWorktree(ctx: DeployContext, request: DeployRequest): Promise<void> {
    const exists = gitManager.worktreeExists(request.branch, request.repo);
    if (exists) {
      await gitManager.updateWorktree(request.branch, request.commit, request.repo);
    } else {
      ctx.isNewWorktree = true;
      await gitManager.createWorktree(request.branch, request.commit, request.repo);
    }
    ctx.commit = await gitManager.getCurrentCommit(request.branch, request.repo);
  }

  private async runCommand(command: string, cwd: string, errorCode: ErrorCode, service: string, step: number): Promise<void> {
    const result = await exec(command, cwd);
    if (!result.success) {
      throw { code: errorCode, message: result.stderr || result.stdout, step, service };
    }
  }

  private buildError(code: ErrorCode, message: string, logs?: string, step?: number, service?: string, duration?: number): ErrorResponse {
    return { success: false, error: { code, message, logs, step, service }, duration: duration ?? 0 };
  }
}

export const deployService = new DeployService();
