export enum ApplicationFailureKind {
  VALIDATION = "validation",
  NOT_FOUND = "not_found",
  CONFLICT = "conflict",
  UPSTREAM = "upstream",
  CONFIGURATION = "configuration",
}

interface ApplicationErrorOptions {
  code?: string;
  details?: string;
  cause?: unknown;
}

export class ApplicationError extends Error {
  readonly code?: string;
  readonly details?: string;

  constructor(
    readonly kind: ApplicationFailureKind,
    message: string,
    options: ApplicationErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApplicationError";
    this.code = options.code;
    this.details = options.details;
  }
}
