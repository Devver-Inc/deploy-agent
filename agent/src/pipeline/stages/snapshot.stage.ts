import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import type { DeployRequest, RollbackSnapshot } from "../../types";

/**
 * Captures the current port, Nginx and process state
 * before any mutations occur, so rollback can restore it.
 */
export class SnapshotStage implements DeployStageHandler {
  readonly name = "snapshot" as const;

  constructor(private readonly registry: ServiceRegistry) {}

  async execute(ctx: DeployContext, _request: DeployRequest): Promise<void> {
    const previousEntry = this.registry.port.get(ctx.deploymentId);
    const nginxConfig = this.registry.nginx.getConfigSnapshot(ctx.deploymentId);
    const processes = await this.registry.pm2.snapshotDeployment(
      ctx.deploymentId,
    );

    const snapshot: RollbackSnapshot = {
      previousEntry,
      nginxConfig,
      processes,
    };

    ctx.rollbackSnapshot = snapshot;
  }
}
