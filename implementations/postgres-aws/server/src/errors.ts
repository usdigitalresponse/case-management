// Errors with an HTTP response, which ./app.ts's error middleware sends, so routes need no catch blocks.
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  toResponseBody(): Record<string, unknown> {
    return { error: this.code, message: this.message };
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'validation_error';

  constructor(readonly fieldErrors: Record<string, string>) {
    super('Invalid input.');
  }

  override toResponseBody(): Record<string, unknown> {
    return { error: this.code, fieldErrors: this.fieldErrors };
  }
}

export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code = 'unauthenticated';

  constructor() {
    super('Authentication required.');
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'not_found';
}

export class ConflictError extends AppError {
  readonly status = 409;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Required reference data (see ./db/ensureReferenceData.ts) is missing — a
// deployment problem, not a client one.
export class ConfigurationError extends AppError {
  readonly status = 500;
  readonly code = 'configuration_error';
}
