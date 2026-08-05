import {
  ApplicationError,
  ApplicationFailureKind,
} from "../errors/application-error";

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

interface ErrorFallback {
  code: string;
  message: string;
  status?: number;
}

const HTTP_STATUS_BY_FAILURE: Record<ApplicationFailureKind, number> = {
  [ApplicationFailureKind.VALIDATION]: 400,
  [ApplicationFailureKind.NOT_FOUND]: 404,
  [ApplicationFailureKind.CONFLICT]: 409,
  [ApplicationFailureKind.UPSTREAM]: 502,
  [ApplicationFailureKind.CONFIGURATION]: 500,
};

export function toApiError(
  error: unknown,
  fallback: ErrorFallback,
): { status: number; body: ApiErrorPayload } {
  if (error instanceof ApplicationError) {
    return {
      status: HTTP_STATUS_BY_FAILURE[error.kind],
      body: {
        success: false,
        error: {
          code: error.code ?? fallback.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = fallback.status ?? 500;

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
