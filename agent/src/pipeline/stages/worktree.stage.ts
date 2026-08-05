import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import { DeployError } from "../../utils/deploy-error";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";
import { resolvePathWithin } from "../../utils/validation";
import { resolveRuntime } from "../runtime-strategy";

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

      ctx.runtime = resolveRuntime(ctx.servicePath) ?? undefined;
      if (ctx.runtime) {
        serviceConfig.install ??= ctx.runtime.installCommand;
        serviceConfig.start ??= ctx.runtime.startCommand;
      }

      if (!serviceConfig.start) {
        const detectedRuntime = ctx.runtime
          ? `Detected '${ctx.runtime.id}' runtime, but`
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
