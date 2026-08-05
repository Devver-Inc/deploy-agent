import {
  DeployRequest,
  DeployResponse,
  ErrorResponse,
  ErrorCode,
  type ServiceName,
  type DeployBenchmark,
} from "../types";
import { matchesDeployment } from "../services/pm2-manager";
import { lifecycleLock } from "../services/deploy/lifecycle-lock";
import { DeployValidator } from "../services/deploy/deploy-validator";
import { DeployLogger } from "../services/deploy/deploy-logger";
import { DeployErrorFactory } from "../services/deploy/deploy-error-factory";
import { RollbackService } from "./rollback";
import { defaultRegistry } from "./registry";
import type { ServiceRegistry } from "./contracts";
import type { DeployContext } from "./context";
import type { DeployStageHandler } from "./stages/stage.interface";
import { randomUUID } from "crypto";

// Stage imports
import { ValidationStage } from "./stages/validation.stage";
import { SnapshotStage } from "./stages/snapshot.stage";
import { WorktreeStage } from "./stages/worktree.stage";
import { InstallStage } from "./stages/install.stage";
import { BuildStage } from "./stages/build.stage";
import { ProcessStage } from "./stages/process.stage";
import { NginxStage } from "./stages/nginx.stage";

export class DeployPipeline {
  private readonly validator = new DeployValidator();
  private readonly logger = new DeployLogger();
  private readonly errors = new DeployErrorFactory();

  constructor(private readonly registry: ServiceRegistry = defaultRegistry) {}

  /**
   * Build the ordered list of stages for a deployment.
   */
  private buildStages(): DeployStageHandler[] {
    const reg = this.registry;
    return [
      new ValidationStage(reg),
      new SnapshotStage(reg),
      new WorktreeStage(reg),
      new InstallStage(
        (cmd, svc, step, stage) =>
          this.validator.validateRuntimeCommand(cmd, svc, step, stage),
        (cmd, out, err) => this.errors.formatCommandLogs(cmd, out, err),
      ),
      new BuildStage(
        (cmd, svc, step, stage) =>
          this.validator.validateRuntimeCommand(cmd, svc, step, stage),
        (cmd, out, err) => this.errors.formatCommandLogs(cmd, out, err),
      ),
      new ProcessStage(reg, (cmd, svc, step, stage) =>
        this.validator.validateRuntimeCommand(cmd, svc, step, stage),
      ),
      new NginxStage(reg),
    ];
  }

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
      deploymentId: this.registry.git.getDeploymentId(
        request.branch,
        request.repo,
      ),
      requestId: randomUUID(),
      commit: request.commit ?? "",
      projectId: request.projectId,
      organizationId: request.organizationId,
      overlayAccessControl: request.overlayAccessControl,
      worktreeTouched: false,
      worktreePromoted: false,
      processTouched: false,
      nginxTouched: false,
      portAllocated: false,
      benchmark: {},
      onPhaseComplete,
    };

    return lifecycleLock.run(async () => {
      try {
        this.validator.validateRequest(request);
        this.resolveService(ctx, request);
        await this.executeStages(ctx, request);
        return await this.buildSuccessResponse(ctx, startTime);
      } catch (error: unknown) {
        return this.handleDeployError(ctx, error, startTime);
      }
    });
  }

  private resolveService(ctx: DeployContext, request: DeployRequest): void {
    const [serviceName, config] = Object.entries(request.service)[0] as [
      ServiceName,
      NonNullable<DeployRequest["service"][ServiceName]>,
    ];
    ctx.serviceName = serviceName;
    ctx.serviceConfig = { ...config };
  }

  private async executeStages(
    ctx: DeployContext,
    request: DeployRequest,
  ): Promise<void> {
    const stages = this.buildStages();

    for (const stage of stages) {
      await this.timed(ctx, stage.name, () => stage.execute(ctx, request));
    }
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

    const rollbackService = new RollbackService(
      this.registry,
      (level, event, data) => this.logger.log(level, event, data),
    );
    const rollback = await rollbackService.rollback(ctx);

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

  private async buildSuccessResponse(
    ctx: DeployContext,
    startTime: number,
  ): Promise<DeployResponse> {
    if (ctx.worktreePromoted) {
      try {
        await this.registry.git.cleanupBackupWorktree(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        );
      } catch (error: unknown) {
        this.logger.log("error", "deploy.release_cleanup_failed", {
          requestId: ctx.requestId,
          repo: ctx.repo,
          branch: ctx.branch,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log("info", "deploy.success", {
      requestId: ctx.requestId,
      repo: ctx.repo,
      branch: ctx.branch,
      commit: ctx.commit,
      durationMs: Date.now() - startTime,
      benchmark: ctx.benchmark,
    });

    const entry = this.registry.port.get(ctx.deploymentId)!;
    const processes = await this.registry.pm2.list();

    return {
      success: true,
      repo: ctx.repo,
      branch: ctx.branch,
      deploymentId: ctx.deploymentId,
      commit: ctx.commit,
      service: { [entry.serviceName]: { port: entry.port, url: entry.url } },
      process:
        processes.find((p) => matchesDeployment(p.name, ctx.deploymentId)) ??
        null,
      duration: Date.now() - startTime,
      benchmark: ctx.benchmark,
    };
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
}

export const deployPipeline = new DeployPipeline();
