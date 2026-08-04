import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import { DeployError } from "../../utils/deploy-error";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";

/**
 * Validates state that can be checked before touching the worktree.
 */
export class ValidationStage implements DeployStageHandler {
  readonly name = "validation" as const;

  constructor(private readonly registry: ServiceRegistry) {}

  async execute(_ctx: DeployContext, request: DeployRequest): Promise<void> {
    // Validate repo existence
    if (!this.registry.repo.exists(request.repo)) {
      throw new DeployError(
        ErrorCode.REPO_NOT_FOUND,
        `Repo '${request.repo}' does not exist. Create it first via POST /repos.`,
        { step: 0, stage: DeployStage.VALIDATION },
      );
    }
  }
}
