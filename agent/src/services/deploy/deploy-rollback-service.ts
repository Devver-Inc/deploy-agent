import { gitManager } from "../git-manager";
import { nginxManager } from "../nginx-manager";
import { pm2Manager } from "../pm2-manager";
import { portManager } from "../port-manager";
import { DeployStage, ErrorCode, type DeployRequest } from "../../types";
import type {
  DeployContext,
  DeployFailure,
  RollbackResult,
  RollbackSnapshot,
} from "./internal-types";
import type { DeployLogger } from "./deploy-logger";

export class DeployRollbackService {
  constructor(private readonly logger: DeployLogger) {}

  async captureSnapshot(
    ctx: DeployContext,
    request: DeployRequest,
  ): Promise<void> {
    const previousEntry = portManager.get(ctx.deploymentId);
    const nginxConfig = nginxManager.getConfigSnapshot(ctx.deploymentId);
    let previousCommit: string | undefined;

    if (gitManager.worktreeExists(request.branch, request.repo)) {
      try {
        previousCommit = await gitManager.getCurrentCommit(
          request.branch,
          request.repo,
        );
      } catch (error: any) {
        const failure: DeployFailure = {
          code: ErrorCode.GIT_ERROR,
          message: "Failed to capture current commit for rollback.",
          logs: error?.message,
          step: 1,
          stage: DeployStage.WORKTREE,
        };
        throw failure;
      }
    }

    const rollbackSnapshot: RollbackSnapshot = {
      previousCommit,
      previousEntry,
      nginxConfig,
    };

    ctx.rollbackSnapshot = rollbackSnapshot;
  }

  async rollback(ctx: DeployContext): Promise<RollbackResult> {
    const issues: string[] = [];

    if (ctx.startedProcess) {
      try {
        await pm2Manager.delete(ctx.startedProcess);
      } catch (error: any) {
        issues.push(
          `pm2 delete ${ctx.startedProcess}: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    if (ctx.rollbackSnapshot) {
      try {
        if (ctx.rollbackSnapshot.previousEntry) {
          portManager.update(
            ctx.deploymentId,
            ctx.rollbackSnapshot.previousEntry,
          );
        } else {
          portManager.release(ctx.deploymentId);
        }
      } catch (error: any) {
        issues.push(`restore ports: ${error?.message ?? "unknown error"}`);
      }
    } else if (ctx.portAllocated) {
      portManager.release(ctx.deploymentId);
    }

    if (ctx.isNewWorktree) {
      try {
        await gitManager.removeWorktree(ctx.branch, ctx.repo);
      } catch (error: any) {
        issues.push(`remove worktree: ${error?.message ?? "unknown error"}`);
      }
    } else if (ctx.rollbackSnapshot?.previousCommit) {
      try {
        await gitManager.updateWorktree(
          ctx.branch,
          ctx.rollbackSnapshot.previousCommit,
          ctx.repo,
        );
      } catch (error: any) {
        issues.push(
          `restore worktree commit: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    try {
      if (
        ctx.rollbackSnapshot?.nginxConfig.exists &&
        ctx.rollbackSnapshot.nginxConfig.content
      ) {
        nginxManager.restoreConfig(
          ctx.deploymentId,
          ctx.rollbackSnapshot.nginxConfig.content,
        );
      } else {
        await nginxManager.removeConfig(ctx.deploymentId);
      }
      await nginxManager.reload();
    } catch (error: any) {
      issues.push(`restore nginx config: ${error?.message ?? "unknown error"}`);
    }

    const rollbackResult: RollbackResult = {
      attempted: true,
      success: issues.length === 0,
      message: issues.length > 0 ? issues.join(" | ") : undefined,
    };

    this.logger.log(
      rollbackResult.success ? "info" : "error",
      "deploy.rollback",
      {
        requestId: ctx.requestId,
        repo: ctx.repo,
        branch: ctx.branch,
        deploymentId: ctx.deploymentId,
        rollback: rollbackResult,
      },
    );

    return rollbackResult;
  }
}
