import type { DeployContext } from "../context";
import type { DeployRequest, DeployBenchmark } from "../../types";

/**
 * A single stage in the deployment pipeline.
 *
 * Each stage is responsible for one concern. Rollback is coordinated
 * centrally from the state recorded in DeployContext.
 */
export interface DeployStageHandler {
  readonly name: keyof DeployBenchmark;
  execute(ctx: DeployContext, request: DeployRequest): Promise<void>;
}
