import { DeployStage, ErrorCode, type DeployRequest } from "../../types";
import {
  assertSafeShellCommand,
  isValidBranch,
  isValidCommit,
  isValidRepoName,
  resolvePathWithin,
} from "../../utils/validation";
import { DeployError } from "../../utils/deploy-error";

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
    if (entries.length !== 1) {
      throw this.validationFailure("Request must include exactly one service.");
    }
    const [serviceName, config] = entries[0]!;

    if (config.root) {
      try {
        resolvePathWithin(".", config.root);
      } catch (error: any) {
        throw this.validationFailure(
          `Invalid root path for service '${serviceName}'.`,
          error?.message,
          serviceName,
        );
      }
    }

    try {
      if (config.install) assertSafeShellCommand(config.install);
      if (config.build) assertSafeShellCommand(config.build);
      if (config.start) assertSafeShellCommand(config.start);
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
      throw new DeployError(
        ErrorCode.VALIDATION_ERROR,
        `Unsafe command detected for service '${service}'.`,
        { logs: error?.message, step, stage, service },
      );
    }
  }

  private validationFailure(
    message: string,
    logs?: string,
    service?: string,
  ): DeployError {
    return new DeployError(ErrorCode.VALIDATION_ERROR, message, {
      logs,
      step: 0,
      stage: DeployStage.VALIDATION,
      service,
    });
  }
}
