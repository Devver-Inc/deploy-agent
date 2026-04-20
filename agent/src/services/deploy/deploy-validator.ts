import { DeployStage, ErrorCode, type DeployRequest } from "../../types";
import { isValidBranch, isValidCommit, isValidRepoName } from "../../utils/validation";
import { parseCommand } from "../../utils/command-parser";
import type { DeployFailure } from "./internal-types";

export class DeployValidator {
  validateRequest(request: DeployRequest): void {
    if (!isValidRepoName(request.repo)) {
      throw this.validationFailure("Invalid repository name.");
    }

    if (!isValidBranch(request.branch)) {
      throw this.validationFailure("Invalid branch name.");
    }

    if (request.commit && !isValidCommit(request.commit)) {
      throw this.validationFailure("Invalid commit hash.");
    }

    const entries = Object.entries(request.service);
    if (entries.length === 0) {
      throw this.validationFailure("Request must include exactly one service.");
    }
    const [serviceName, config] = entries[0]!;
    try {
      parseCommand(config.install || "bun install");
      if (config.build) parseCommand(config.build);
      parseCommand(config.start);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw this.validationFailure(
        `Unsafe command detected in service '${serviceName}'.`,
        err.message,
        serviceName,
      );
    }
  }

  validateRuntimeCommand(
    command: string,
    service: string,
    step: number,
    stage: DeployStage,
  ): void {
    try {
      parseCommand(command);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failure: DeployFailure = {
        code: ErrorCode.VALIDATION_ERROR,
        message: `Unsafe command detected for service '${service}'.`,
        logs: err.message,
        step,
        stage,
        service,
      };
      throw failure;
    }
  }

  private validationFailure(
    message: string,
    logs?: string,
    service?: string,
  ): DeployFailure {
    return {
      code: ErrorCode.VALIDATION_ERROR,
      message,
      logs,
      step: 0,
      stage: DeployStage.VALIDATION,
      service,
    };
  }
}