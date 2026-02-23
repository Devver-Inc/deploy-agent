export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
  }
}

interface ErrorFallback {
  code: string;
  message: string;
  status?: number;
}

function inferStatusFromMessage(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("already exists") || lower.includes("conflict"))
    return 409;
  if (lower.includes("not found") || lower.includes("does not exist"))
    return 404;
  if (lower.includes("invalid") || lower.includes("unsafe")) return 400;
  return 500;
}

export function toApiError(
  error: unknown,
  fallback: ErrorFallback,
): { status: number; body: ApiErrorPayload } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = fallback.status ?? inferStatusFromMessage(message);

  return {
    status,
    body: {
      success: false,
      error: {
        code: fallback.code,
        message: message || fallback.message,
        details: message && message !== fallback.message ? message : undefined,
      },
    },
  };
}
