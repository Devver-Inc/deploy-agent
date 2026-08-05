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
      try {
        await this.registry.pm2.deleteByDeployment(ctx.deploymentId);
      } catch (error: any) {
        issues.push(
          `delete failed deployment processes: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    // Restore the previous immutable release before restarting its process.
    if (ctx.worktreePromoted) {
      try {
        await this.registry.git.rollbackPromotion(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        );
      } catch (error: any) {
        issues.push(`restore worktree: ${error?.message ?? "unknown error"}`);
      }
    } else if (ctx.worktreeTouched) {
      try {
        await this.registry.git.discardCandidateWorktree(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        );
      } catch (error: any) {
        issues.push(`discard candidate: ${error?.message ?? "unknown error"}`);
      }
    }

    if (ctx.portAllocated) {
      try {
        if (ctx.rollbackSnapshot?.previousEntry) {
          this.registry.port.update(
            ctx.deploymentId,
            ctx.rollbackSnapshot.previousEntry,
          );
        } else {
          this.registry.port.release(ctx.deploymentId);
        }
      } catch (error: any) {
        issues.push(`restore ports: ${error?.message ?? "unknown error"}`);
      }
    }

    if (ctx.processTouched && ctx.rollbackSnapshot?.processes.length) {
      try {
        await this.registry.pm2.restoreSnapshots(
          ctx.rollbackSnapshot.processes,
        );
      } catch (error: any) {
        issues.push(
          `restore PM2 processes: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    if (ctx.nginxTouched) {
      try {
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
      } catch (error: any) {
        issues.push(
          `restore nginx config: ${error?.message ?? "unknown error"}`,
        );
      }
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
