import { DeployStage, ErrorCode, type ErrorResponse } from "../../types";
import type { DeployFailure, RollbackResult } from "./internal-types";

export class DeployErrorFactory {
  normalize(error: any): DeployFailure {
    if (error && typeof error === "object" && error.code && error.message) {
      return {
        code: error.code,
        message: error.message,
        logs: error.logs,
        step: error.step,
        stage: error.stage,
        service: error.service,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Dependency cycle detected") ||
      message.includes("depends on unknown service")
    ) {
      return {
        code: ErrorCode.VALIDATION_ERROR,
        message,
        stage: DeployStage.VALIDATION,
        step: 0,
      };
    }

    return {
      code: ErrorCode.DEPLOY_ERROR,
      message,
      stage: DeployStage.VALIDATION,
    };
  }

  buildErrorResponse(
    code: ErrorCode,
    message: string,
    logs?: string,
    step?: number,
    stage?: DeployStage,
    service?: string,
    rollback?: RollbackResult,
    duration?: number,
  ): ErrorResponse {
    return {
      success: false,
      error: {
        code,
        message,
        logs,
        step,
        stage,
        service,
        rollback,
      },
      duration: duration ?? 0,
    };
  }

  formatCommandLogs(command: string, stdout: string, stderr: string): string {
    const sections = [`$ ${command}`];
    if (stdout?.trim()) sections.push("--- stdout ---", stdout.trim());
    if (stderr?.trim()) sections.push("--- stderr ---", stderr.trim());
    return this.trimLogs(sections.join("\n"));
  }

  private trimLogs(logs: string, maxLength = 12000): string {
    if (logs.length <= maxLength) return logs;
    return `${logs.slice(0, maxLength)}\n... (logs truncated)`;
  }
}
