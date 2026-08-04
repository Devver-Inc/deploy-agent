import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import { DeployError } from "../../utils/deploy-error";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";
import { resolvePathWithin } from "../../utils/validation";
import { detectRuntime } from "../runtime-detector";

/**
 * Creates or updates the git worktree for the target branch.
 */
export class WorktreeStage implements DeployStageHandler {
  readonly name = "worktree" as const;

  constructor(private readonly registry: ServiceRegistry) {}

  async execute(ctx: DeployContext, request: DeployRequest): Promise<void> {
    try {
      ctx.worktreeTouched = true;
      const candidateWorktreePath =
        await this.registry.git.createCandidateWorktree(
          request.branch,
          request.commit,
          request.repo,
          ctx.requestId,
        );
      ctx.commit = await this.registry.git.getCommitAtPath(
        candidateWorktreePath,
      );

      const serviceName = ctx.serviceName;
      const serviceConfig = ctx.serviceConfig;
      if (!serviceName || !serviceConfig) {
        throw new DeployError(
          ErrorCode.VALIDATION_ERROR,
          "Service configuration was not resolved before worktree setup.",
          { step: 1, stage: DeployStage.WORKTREE },
        );
      }
      ctx.servicePath = resolvePathWithin(
        candidateWorktreePath,
        serviceConfig.root,
      );

      const detected = detectRuntime(ctx.servicePath);
      if (detected) {
        ctx.runtimeLanguage = detected.language;
        ctx.runtimePackageManager = detected.packageManager;
        ctx.runtimeNeedsCliPort = detected.needsCliPort;
        serviceConfig.install ??= detected.installCmd;
        serviceConfig.start ??= detected.startCmd;
      }

      if (!serviceConfig.start) {
        const detectedRuntime = detected
          ? `Detected '${detected.language}' runtime, but`
          : "";
        throw new DeployError(
          ErrorCode.VALIDATION_ERROR,
          `${detectedRuntime} no start command was provided. Add 'service.start' or a Procfile with an explicit 'web:' command in '${serviceConfig.root ?? "."}'.`.trim(),
          {
            step: 1,
            stage: DeployStage.WORKTREE,
            service: serviceName,
          },
        );
      }
    } catch (error: unknown) {
      if (error instanceof DeployError) throw error;
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
}
