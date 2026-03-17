import {
  DeployRequest,
  DeployResponse,
  ErrorResponse,
  DeployStage,
  ErrorCode,
  ServiceConfig,
  DeploymentResponse,
  ListDeploymentsQuery,
} from "../types";
import { gitManager } from "./git-manager";
import { portManager } from "./port-manager";
import { pm2Manager, matchesDeployment } from "./pm2-manager";
import { nginxManager } from "./nginx-manager";
import { repoManager } from "./repo-manager";
import { exec } from "../utils/exec";
import { prepareSmartCommand, buildEnvVars } from "../utils/deploy-helpers";
import { safeBranch } from "../utils/branch";
import { join } from "path";
import { DeploymentLock } from "./deploy/deployment-lock";
import { DeployValidator } from "./deploy/deploy-validator";
import { DeployLogger } from "./deploy/deploy-logger";
import { DeployErrorFactory } from "./deploy/deploy-error-factory";
import { DeployRollbackService } from "./deploy/deploy-rollback-service";
import type { DeployContext } from "./deploy/internal-types";

export class DeployService {
  private lock = new DeploymentLock();
  private validator = new DeployValidator();
  private logger = new DeployLogger();
  private errors = new DeployErrorFactory();
  private rollbackService = new DeployRollbackService(this.logger);

  async deploy(
    request: DeployRequest,
  ): Promise<DeployResponse | ErrorResponse> {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startTime = Date.now();
    const deploymentId = gitManager.getDeploymentId(
      request.branch,
      request.repo,
    );

    const ctx: DeployContext = {
      repo: request.repo,
      branch: request.branch,
      deploymentId,
      requestId,
      commit: request.commit ?? "",
      isNewWorktree: false,
      portAllocated: false,
    };

    const [serviceName, serviceConfig] = Object.entries(request.service)[0];

    return this.lock.withLock(ctx.deploymentId, async () => {
      this.logger.log("info", "deploy.start", {
        requestId: ctx.requestId,
        repo: request.repo,
        branch: request.branch,
        deploymentId,
        serviceName,
      });

      try {
        this.validator.validateRequest(request);

        if (!repoManager.exists(request.repo)) {
          throw {
            code: ErrorCode.REPO_NOT_FOUND,
            message: `Repo '${request.repo}' does not exist. Create it first via POST /repos.`,
            step: 0,
            stage: DeployStage.VALIDATION,
          };
        }

        await this.rollbackService.captureSnapshot(ctx, request);
        await this.setupWorktree(ctx, request);

        const { port, url } = await this.deployService(
          ctx,
          serviceName,
          serviceConfig,
          request.env ?? {},
        );

        await this.setupNginx(ctx, serviceName, port);

        this.logger.log("info", "deploy.success", {
          requestId: ctx.requestId,
          repo: ctx.repo,
          branch: ctx.branch,
          commit: ctx.commit,
          durationMs: Date.now() - startTime,
        });

        const processes = await pm2Manager.list();
        const process = processes.find((p) => matchesDeployment(p.name, ctx.deploymentId)) ?? null;

        return {
          success: true,
          repo: ctx.repo,
          branch: ctx.branch,
          deploymentId: ctx.deploymentId,
          commit: ctx.commit,
          serviceName,
          port,
          url,
          process,
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        const normalized = this.errors.normalize(error);
        this.logger.log("error", "deploy.failed", {
          requestId: ctx.requestId,
          repo: ctx.repo,
          branch: ctx.branch,
          code: normalized.code,
          step: normalized.step,
          stage: normalized.stage,
          service: normalized.service,
          message: normalized.message,
        });

        const rollback = await this.rollbackService.rollback(ctx);
        return this.errors.buildErrorResponse(
          rollback.success ? normalized.code : ErrorCode.ROLLBACK_ERROR,
          normalized.message,
          normalized.logs,
          normalized.step,
          normalized.stage,
          normalized.service,
          rollback,
          Date.now() - startTime,
        );
      }
    });
  }

  private async deployService(
    ctx: DeployContext,
    serviceName: string,
    config: ServiceConfig,
    extraEnv: Record<string, string>,
  ): Promise<{ port: number; url: string }> {
    const worktreePath = gitManager.getWorktreePath(ctx.branch, ctx.repo);
    const servicePath = config.root
      ? join(worktreePath, config.root)
      : worktreePath;

    let port: number;
    try {
      port = await portManager.allocate(ctx.deploymentId);
    } catch (error: any) {
      throw {
        code: ErrorCode.PORT_CONFLICT,
        message: `Failed to allocate port for service '${serviceName}'.`,
        logs: error?.message,
        step: 2,
        stage: DeployStage.INSTALL,
        service: serviceName,
      };
    }

    ctx.portAllocated = true;

    const smartCommand = prepareSmartCommand(
      config.start || "bun run start",
      port,
    );
    const env = {
      ...buildEnvVars(extraEnv),
      PORT: port.toString(),
      HOST: "0.0.0.0",
    };

    if (!config.skipInstall) {
      await this.runCommand(
        config.install || "bun install",
        servicePath,
        ErrorCode.INSTALL_ERROR,
        serviceName,
        2,
        DeployStage.INSTALL,
      );
    }
    if (config.build) {
      await this.runCommand(
        config.build,
        servicePath,
        ErrorCode.BUILD_ERROR,
        serviceName,
        3,
        DeployStage.BUILD,
      );
    }

    try {
      const processName = await pm2Manager.start(
        serviceName,
        ctx.deploymentId,
        port,
        smartCommand,
        servicePath,
        env,
      );
      ctx.startedProcess = processName;
      await this.waitForPort(port, serviceName);
    } catch (error: any) {
      throw {
        code: ErrorCode.PROCESS_ERROR,
        message: `Failed to start process for service '${serviceName}'.`,
        logs: error?.message,
        service: serviceName,
        step: 4,
        stage: DeployStage.PROCESS,
      };
    }

    const baseUrl = repoManager.getBaseUrl(ctx.repo);
    const url = `${baseUrl}/${ctx.repo}/${safeBranch(ctx.branch)}${serviceName !== "web" ? `/${serviceName}` : ""}`;

    portManager.update(ctx.deploymentId, { serviceName, port, url });

    return { port, url };
  }

  async listDeployments({ repo }: ListDeploymentsQuery = {}): Promise<DeploymentResponse[]> {
    const repos = repo ? [repo] : repoManager.list().map((r) => r.name);
    const processes = await pm2Manager.list();
    const registry = portManager.getAll();

    const results: DeploymentResponse[] = [];
    for (const r of repos) {
      const branches = await gitManager.listWorktrees(r);
      for (const branch of branches) {
        const deploymentId = gitManager.getDeploymentId(branch, r);
        const commit = await gitManager.getCurrentCommit(branch, r);
        const entry = registry[deploymentId];
        results.push({
          repo: r,
          branch,
          deploymentId,
          commit,
          serviceName: entry?.serviceName ?? "",
          port: entry?.port ?? 0,
          url: entry?.url ?? "",
          process: processes.find((p) => matchesDeployment(p.name, deploymentId)) ?? null,
        });
      }
    }
    return results;
  }

  private async findDeploymentLocation(
    deploymentId: string,
  ): Promise<{ branch: string; repo: string } | undefined> {
    for (const { name: repo } of repoManager.list()) {
      const branch = (await gitManager.listWorktrees(repo)).find(
        (b) => gitManager.getDeploymentId(b, repo) === deploymentId,
      );
      if (branch) return { branch, repo };
    }
  }

  async removeDeployment(deploymentId: string): Promise<void> {
    const location = await this.findDeploymentLocation(deploymentId);
    await Promise.all([
      pm2Manager.deleteByBranch(deploymentId),
      location
        ? gitManager.removeWorktree(location.branch, location.repo)
        : Promise.resolve(),
      nginxManager.removeConfig(deploymentId),
    ]);
    portManager.release(deploymentId);
    await nginxManager.reload();
  }

  async deleteRepo(name: string): Promise<void> {
    const deployments = await this.listDeployments({ repo: name });
    for (const dep of deployments) {
      await this.removeDeployment(dep.deploymentId);
    }
    await repoManager.delete(name);
  }

  private async setupNginx(
    ctx: DeployContext,
    serviceName: string,
    port: number,
  ): Promise<void> {
    try {
      await nginxManager.writeConfig(
        ctx.deploymentId,
        ctx.repo,
        ctx.branch,
        { service: serviceName, port },
      );
      await nginxManager.reload();
    } catch (error: any) {
      throw {
        code: ErrorCode.NGINX_ERROR,
        message: "Failed to write or reload Nginx configuration.",
        logs: error?.message,
        step: 5,
        stage: DeployStage.NGINX,
      };
    }
  }

  private async setupWorktree(
    ctx: DeployContext,
    request: DeployRequest,
  ): Promise<void> {
    try {
      const exists = gitManager.worktreeExists(request.branch, request.repo);
      if (exists) {
        await gitManager.updateWorktree(
          request.branch,
          request.commit,
          request.repo,
        );
      } else {
        ctx.isNewWorktree = true;
        await gitManager.createWorktree(
          request.branch,
          request.commit,
          request.repo,
        );
      }
      ctx.commit = await gitManager.getCurrentCommit(
        request.branch,
        request.repo,
      );
    } catch (error: any) {
      throw {
        code: ErrorCode.GIT_ERROR,
        message: "Failed to setup deployment worktree.",
        logs: error?.message,
        step: 1,
        stage: DeployStage.WORKTREE,
      };
    }
  }

  private async waitForPort(port: number, service: string, timeoutMs = 60000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`Service '${service}' did not respond on port ${port} within ${timeoutMs}ms`);
  }

  private async runCommand(
    command: string,
    cwd: string,
    errorCode: ErrorCode,
    service: string,
    step: number,
    stage: DeployStage,
  ): Promise<void> {
    this.validator.validateRuntimeCommand(command, service, step, stage);

    const result = await exec(command, cwd);
    if (!result.success) {
      const logs = this.errors.formatCommandLogs(
        command,
        result.stdout,
        result.stderr,
      );
      throw {
        code: errorCode,
        message: `${stage} command failed for service '${service}' (exit code ${result.exitCode}).`,
        logs,
        step,
        stage,
        service,
      };
    }
  }
}

export const deployService = new DeployService();
