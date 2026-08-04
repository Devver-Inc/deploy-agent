import type { ServiceRegistry } from "./contracts";
import type { DeployContext } from "./context";
import type { RollbackResult } from "../types";

/**
 * Restores only resources touched by the failed deployment attempt.
 */
export class RollbackService {
  constructor(
    private readonly registry: ServiceRegistry,
    private readonly log: (
      level: "info" | "error",
      event: string,
      data: Record<string, unknown>,
    ) => void,
  ) {}

  async rollback(ctx: DeployContext): Promise<RollbackResult> {
    const issues: string[] = [];
    const attempt = async (
      label: string,
      action: () => Promise<void> | void,
    ): Promise<void> => {
      try {
        await action();
      } catch (error: unknown) {
        issues.push(
          `${label}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    };
    const attempted =
      ctx.worktreeTouched ||
      ctx.processTouched ||
      ctx.portAllocated ||
      ctx.nginxTouched;

    if (!attempted) {
      return { attempted: false, success: true };
    }

    // Stop any process created or replaced by this attempt.
    if (ctx.processTouched) {
      await attempt("delete failed deployment processes", () =>
        this.registry.pm2.deleteByDeployment(ctx.deploymentId),
      );
    }

    // Restore the previous immutable release before restarting its process.
    if (ctx.worktreePromoted) {
      await attempt("restore worktree", () =>
        this.registry.git.rollbackPromotion(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        ),
      );
    } else if (ctx.worktreeTouched) {
      await attempt("discard candidate", () =>
        this.registry.git.discardCandidateWorktree(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        ),
      );
    }

    if (ctx.portAllocated) {
      await attempt("restore ports", () => {
        if (ctx.rollbackSnapshot?.previousEntry) {
          this.registry.port.update(
            ctx.deploymentId,
            ctx.rollbackSnapshot.previousEntry,
          );
        } else {
          this.registry.port.release(ctx.deploymentId);
        }
      });
    }

    const previousProcesses = ctx.rollbackSnapshot?.processes;
    if (ctx.processTouched && previousProcesses?.length) {
      await attempt("restore PM2 processes", () =>
        this.registry.pm2.restoreSnapshots(previousProcesses),
      );
    }

    if (ctx.nginxTouched) {
      await attempt("restore nginx config", async () => {
        if (
          ctx.rollbackSnapshot?.nginxConfig.exists &&
          ctx.rollbackSnapshot.nginxConfig.content
        ) {
          this.registry.nginx.restoreConfig(
            ctx.deploymentId,
            ctx.rollbackSnapshot.nginxConfig.content,
          );
        } else {
          await this.registry.nginx.removeConfig(ctx.deploymentId);
        }
        await this.registry.nginx.reload();
      });
    }

    const result: RollbackResult = {
      attempted,
      success: issues.length === 0,
      message: issues.length > 0 ? issues.join(" | ") : undefined,
    };

    this.log(result.success ? "info" : "error", "deploy.rollback", {
      requestId: ctx.requestId,
      repo: ctx.repo,
      branch: ctx.branch,
      deploymentId: ctx.deploymentId,
      rollback: result,
    });

    return result;
  }
}
