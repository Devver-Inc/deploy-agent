import { DeployStage, ErrorCode, type DeployRequest } from "../../types";
import {
  assertSafeShellCommand,
  isValidBranch,
  isValidCommit,
  isValidRepoName,
} from "../../utils/validation";
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

    const [serviceName, config] = Object.entries(request.service)[0];
    try {
      assertSafeShellCommand(config.install || "bun install");
      assertSafeShellCommand(config.build);
      assertSafeShellCommand(config.start);
    } catch (error: any) {
      throw this.validationFailure(
        `Unsafe command detected in service '${serviceName}'.`,
        error?.message,
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
      assertSafeShellCommand(command);
    } catch (error: any) {
      const failure: DeployFailure = {
        code: ErrorCode.VALIDATION_ERROR,
        message: `Unsafe command detected for service '${service}'.`,
        logs: error?.message,
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
