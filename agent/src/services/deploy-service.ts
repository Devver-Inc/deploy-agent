import {
  DeployRequest,
  DeployResponse,
  ErrorResponse,
  DeployStage,
  ErrorCode,
  ServiceConfig,
  DeploymentResponse,
  ListDeploymentsQuery,
  type ServiceName,
  type DeployBenchmark,
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
import { writeFileSync } from "fs";
import { DeployError } from "../utils/deploy-error";
import { pollUntil } from "../utils/poll-until";
import { DeploymentLock } from "./deploy/deployment-lock";
import { DeployValidator } from "./deploy/deploy-validator";
import { DeployLogger } from "./deploy/deploy-logger";
import { DeployErrorFactory } from "./deploy/deploy-error-factory";
import { DeployRollbackService } from "./deploy/deploy-rollback-service";
import type { DeployContext } from "./deploy/internal-types";

const DEFAULT_INSTALL_COMMAND = "aube install";
const DEFAULT_START_COMMAND = "aube run start";

export class DeployService {
  private lock = new DeploymentLock();
  private validator = new DeployValidator();
  private logger = new DeployLogger();
  private errors = new DeployErrorFactory();
  private rollbackService = new DeployRollbackService(this.logger);

  async deploy(
    request: DeployRequest,
    onPhaseComplete?: (
      phase: keyof DeployBenchmark,
      durationMs: number,
    ) => void,
  ): Promise<DeployResponse | ErrorResponse> {
    const startTime = Date.now();
    const ctx: DeployContext = {
      repo: request.repo,
      branch: request.branch,
      deploymentId: gitManager.getDeploymentId(request.branch, request.repo),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      commit: request.commit ?? "",
      projectId: request.projectId,
      organizationId: request.organizationId,
      overlayAccessControl: request.overlayAccessControl,
      isNewWorktree: false,
      portAllocated: false,
      benchmark: {},
      onPhaseComplete,
    };

    return this.lock.withLock(ctx.deploymentId, async () => {
      try {
        return await this.executeDeploy(ctx, request, startTime);
      } catch (error: unknown) {
        return this.handleDeployError(ctx, error, startTime);
      }
    });
  }

  private async executeDeploy(
    ctx: DeployContext,
    request: DeployRequest,
    startTime: number,
  ): Promise<DeployResponse> {
    const entries = Object.entries(request.service);
    if (entries.length === 0 || !entries[0]) {
      throw new DeployError(
        ErrorCode.VALIDATION_ERROR,
        "Request must include exactly one service (web or api).",
        {
          step: 0,
          stage: DeployStage.VALIDATION,
        },
      );
    }
    const [name, serviceConfig] = entries[0];
    const serviceName = name as ServiceName;
    serviceConfig.install ??= DEFAULT_INSTALL_COMMAND;
    serviceConfig.start ??= DEFAULT_START_COMMAND;

    const normalizedRequest: DeployRequest = {
      ...request,
      service: { ...request.service, [serviceName]: serviceConfig },
    };

    this.logger.log("info", "deploy.start", {
      requestId: ctx.requestId,
      repo: ctx.repo,
      branch: ctx.branch,
      deploymentId: ctx.deploymentId,
      serviceName,
    });

    await this.timed(ctx, "validation", async () => {
      this.validator.validateRequest(normalizedRequest);

      if (!repoManager.exists(normalizedRequest.repo)) {
        throw new DeployError(
          ErrorCode.REPO_NOT_FOUND,
          `Repo '${normalizedRequest.repo}' does not exist. Create it first via POST /repos.`,
          {
            step: 0,
            stage: DeployStage.VALIDATION,
          },
        );
      }
    });

    await this.timed(ctx, "snapshot", () =>
      this.rollbackService.captureSnapshot(ctx, normalizedRequest),
    );
    await this.timed(ctx, "worktree", () =>
      this.setupWorktree(ctx, normalizedRequest),
    );

    const { port, url } = await this.deployService(
      ctx,
      serviceName,
      serviceConfig,
      normalizedRequest.env ?? {},
    );

    await this.timed(ctx, "nginx", () =>
      this.setupNginx(ctx, serviceName, port),
    );

    this.logger.log("info", "deploy.success", {
      requestId: ctx.requestId,
      repo: ctx.repo,
      branch: ctx.branch,
      commit: ctx.commit,
      durationMs: Date.now() - startTime,
      benchmark: ctx.benchmark,
    });

    const processes = await pm2Manager.list();
    return {
      success: true,
      repo: ctx.repo,
      branch: ctx.branch,
      deploymentId: ctx.deploymentId,
      commit: ctx.commit,
      service: { [serviceName]: { port, url } },
      process:
        processes.find((p) => matchesDeployment(p.name, ctx.deploymentId)) ??
        null,
      duration: Date.now() - startTime,
      benchmark: ctx.benchmark,
    };
  }

  private async handleDeployError(
    ctx: DeployContext,
    error: unknown,
    startTime: number,
  ): Promise<ErrorResponse> {
    const normalized = this.errors.normalize(error);
    this.logger.log("error", "deploy.failed", {
      requestId: ctx.requestId,
      repo: ctx.repo,
      branch: ctx.branch,
      ...normalized,
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

  private async deployService(
    ctx: DeployContext,
    serviceName: ServiceName,
    config: ServiceConfig,
    extraEnv: Record<string, string>,
  ): Promise<{ port: number; url: string }> {
    const worktreePath = gitManager.getWorktreePath(ctx.branch, ctx.repo);
    const servicePath = config.root
      ? join(worktreePath, config.root)
      : worktreePath;

    const port = await this.allocatePort(ctx, serviceName);

    if (Object.keys(extraEnv).length > 0) {
      const content = Object.entries(extraEnv)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n");
      writeFileSync(join(servicePath, ".env"), content);
    }

    if (!config.skipInstall) {
      await this.timed(ctx, "install", () =>
        this.runCommand(
          config.install!,
          servicePath,
          ErrorCode.INSTALL_ERROR,
          serviceName,
          2,
          DeployStage.INSTALL,
        ),
      );
    }
    if (config.build) {
      await this.timed(ctx, "build", () =>
        this.runCommand(
          config.build!,
          servicePath,
          ErrorCode.BUILD_ERROR,
          serviceName,
          3,
          DeployStage.BUILD,
        ),
      );
    }

    await this.timed(ctx, "process", () =>
      this.startProcess(ctx, serviceName, config, port, servicePath, extraEnv),
    );

    const baseUrl = repoManager.getBaseUrl(ctx.repo);
    const url = `${baseUrl}/${ctx.repo}/${safeBranch(ctx.branch)}${serviceName !== "web" ? `/${serviceName}` : ""}`;
    portManager.update(ctx.deploymentId, { serviceName, port, url });

    return { port, url };
  }

  private async allocatePort(
    ctx: DeployContext,
    serviceName: ServiceName,
  ): Promise<number> {
    try {
      const port = await portManager.allocate(ctx.deploymentId, serviceName);
      ctx.portAllocated = true;
      return port;
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.PORT_CONFLICT,
        `Failed to allocate port for service '${serviceName}'.`,
        {
          logs: error instanceof Error ? error.message : String(error),
          step: 2,
          stage: DeployStage.INSTALL,
          service: serviceName,
        },
      );
    }
  }

  private async startProcess(
    ctx: DeployContext,
    serviceName: string,
    config: ServiceConfig,
    port: number,
    servicePath: string,
    extraEnv: Record<string, string>,
  ): Promise<void> {
    const rawCommand = config.start!;
    const command =
      serviceName === "web"
        ? prepareSmartCommand(rawCommand, port)
        : rawCommand;
    const env = {
      ...buildEnvVars(extraEnv),
      PORT: port.toString(),
      HOST: "0.0.0.0",
    };

    try {
      ctx.startedProcess = await pm2Manager.start(
        serviceName,
        ctx.deploymentId,
        port,
        command,
        servicePath,
        env,
      );
      await this.waitForPort(port, serviceName);
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.PROCESS_ERROR,
        `Failed to start process for service '${serviceName}'.`,
        {
          logs: error instanceof Error ? error.message : String(error),
          service: serviceName,
          step: 4,
          stage: DeployStage.PROCESS,
        },
      );
    }
  }

  async listDeployments({ repo }: ListDeploymentsQuery = {}): Promise<
    DeploymentResponse[]
  > {
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
          service: entry
            ? { [entry.serviceName]: { port: entry.port, url: entry.url } }
            : {},
          process:
            processes.find((p) => matchesDeployment(p.name, deploymentId)) ??
            null,
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
    const portEntry = portManager.getAll()[deploymentId];
    await pm2Manager.deleteByBranch(deploymentId);
    if (portEntry) {
      await pm2Manager.killPort(portEntry.port);
    }
    await Promise.all([
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

  private async timed<T>(
    ctx: DeployContext,
    key: keyof DeployBenchmark,
    fn: () => Promise<T>,
  ): Promise<T> {
    const t = Date.now();
    const result = await fn();
    const durationMs = Date.now() - t;
    ctx.benchmark[key] = durationMs;
    ctx.onPhaseComplete?.(key, durationMs);
    return result;
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
        {
          service: serviceName,
          port,
        },
        ctx.projectId,
        ctx.organizationId,
        ctx.overlayAccessControl,
      );
      await nginxManager.reload();
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.NGINX_ERROR,
        "Failed to write or reload Nginx configuration.",
        {
          logs: error instanceof Error ? error.message : String(error),
          step: 5,
          stage: DeployStage.NGINX,
        },
      );
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
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.GIT_ERROR,
        "Failed to setup deployment worktree.",
        {
          logs: error instanceof Error ? error.message : String(error),
          step: 1,
          stage: DeployStage.WORKTREE,
        },
      );
    }
  }

  private async waitForPort(
    port: number,
    service: string,
    timeoutMs = 60000,
  ): Promise<void> {
    await pollUntil(
      async () => {
        try {
          await fetch(`http://127.0.0.1:${port}`, {
            signal: AbortSignal.timeout(1000),
          });
          return true;
        } catch {
          return false;
        }
      },
      timeoutMs,
      `Service '${service}' did not respond on port ${port} within ${timeoutMs}ms`,
    );
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
      throw new DeployError(
        errorCode,
        `${stage} command failed for service '${service}' (exit code ${result.exitCode}).`,
        {
          logs,
          step,
          stage,
          service,
        },
      );
    }
  }
}

export const deployService = new DeployService();
