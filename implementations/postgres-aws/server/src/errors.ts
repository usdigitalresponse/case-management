// Errors that map to a specific HTTP response. Domain actions throw these
// (or a named subclass, so tests and callers can tell cases apart), and
// the error middleware in ./app.ts turns any of them into a response, so
// routes need no per-action catch blocks.
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
