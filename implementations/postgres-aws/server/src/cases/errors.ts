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

export class CaseNotClosedError extends ConflictError {
  constructor() {
    super('not_closed', 'This case is open.');
  }
}

// Closing here is a cleanup, so it waits until every invoice is finished.
export class CaseInvoicesUnfinishedError extends ConflictError {
  constructor(waiting: number, notCompleted: number) {
    const parts = [
      waiting > 0 ? `${waiting} ${waiting === 1 ? 'invoice is' : 'invoices are'} still in review` : null,
      notCompleted > 0 ? `${notCompleted} decided ${notCompleted === 1 ? 'invoice isn’t' : 'invoices aren’t'} marked completed` : null,
    ].filter(Boolean);
    super('invoices_unfinished', `Finish its invoices first: ${parts.join(', and ')}.`);
  }
}
