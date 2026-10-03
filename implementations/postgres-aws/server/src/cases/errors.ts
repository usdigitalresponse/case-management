// Shared across case-scoped actions (assignProfessionalToCase.ts,
// closeCase.ts).
import { ConflictError, NotFoundError } from '../errors';

export class CaseNotFoundError extends NotFoundError {
  constructor() {
    super('Case not found.');
  }
}

export class CaseAlreadyClosedError extends ConflictError {
  constructor() {
    super('already_closed', 'This case is already closed.');
  }
}
