import type { ApiError } from "./contract";

export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly logs?: string,
  ) {
    super(message);
  }

  toJSON(): ApiError {
    return { code: this.code, message: this.message, logs: this.logs };
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof AgentError) return error.toJSON();
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
  };
}
