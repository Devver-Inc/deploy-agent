import { ErrorCode, DeployStage } from "../types";

export interface DeployErrorOptions {
  logs?: string;
  step?: number;
  stage?: DeployStage;
  service?: string;
  context?: Record<string, unknown>;
  cause?: Error;
}

export class DeployError extends Error {
  readonly code: ErrorCode;
  readonly logs?: string;
  readonly step?: number;
  readonly stage?: DeployStage;
  readonly service?: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    options?: DeployErrorOptions,
  ) {
    super(message, { cause: options?.cause });
    this.name = "DeployError";
    this.code = code;
    this.logs = options?.logs;
    this.step = options?.step;
    this.stage = options?.stage;
    this.service = options?.service;
    this.context = options?.context;
    this.cause = options?.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DeployError);
    }
  }

  static wrap(err: unknown): DeployError {
    if (err instanceof DeployError) {
      return err;
    }

    if (err instanceof Error) {
      return new DeployError(
        ErrorCode.DEPLOY_ERROR,
        err.message,
        { cause: err }
      );
    }

    return new DeployError(
      ErrorCode.DEPLOY_ERROR,
      String(err),
    );
  }

  static validation(message: string, context?: Record<string, unknown>): DeployError {
    return new DeployError(ErrorCode.VALIDATION_ERROR, message, { context });
  }

  static gitFailure(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.GIT_ERROR, message, options);
  }

  static portExhausted(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.PORT_CONFLICT, message, options);
  }

  static pm2StartFailed(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.PROCESS_ERROR, message, options);
  }

  static nginxFailed(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.NGINX_ERROR, message, options);
  }

  static rollback(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.ROLLBACK_ERROR, message, options);
  }

  static commandFailed(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.DEPLOY_ERROR, message, options);
  }

  static installError(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.INSTALL_ERROR, message, options);
  }

  static buildError(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.BUILD_ERROR, message, options);
  }

  static notFound(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.REPO_NOT_FOUND, message, options);
  }

  static conflict(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.DEPLOY_ERROR, message, { ...options, context: { ...options?.context, conflict: true } });
  }

  static upstream(message: string, options?: DeployErrorOptions): DeployError {
    return new DeployError(ErrorCode.DEPLOY_ERROR, message, { ...options, context: { ...options?.context, upstream: true } });
  }
}

export { DeployError as DeployFailure };