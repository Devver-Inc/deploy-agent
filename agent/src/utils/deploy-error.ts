import type { DeployStage, ErrorCode } from "../types";

export interface DeployFailureOptions {
  logs?: string;
  step?: number;
  stage?: DeployStage;
  service?: string;
}

export class DeployError extends Error {
  readonly code: ErrorCode;
  readonly logs?: string;
  readonly step?: number;
  readonly stage?: DeployStage;
  readonly service?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options?: DeployFailureOptions,
  ) {
    super(message);
    this.name = "DeployError";
    this.code = code;
    this.logs = options?.logs;
    this.step = options?.step;
    this.stage = options?.stage;
    this.service = options?.service;
  }
}
