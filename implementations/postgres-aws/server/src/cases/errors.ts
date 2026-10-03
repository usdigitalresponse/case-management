// Shared across case-scoped actions (assignProfessionalToCase.ts,
// closeCase.ts) so ../routes/cases.ts can catch one error type per
// condition instead of a different class per action.
export class CaseNotFoundError extends Error {
  constructor() {
    super('Case not found.');
    this.name = 'CaseNotFoundError';
  }
}

export class CaseAlreadyClosedError extends Error {
  constructor() {
    super('This case is already closed.');
    this.name = 'CaseAlreadyClosedError';
  }
}
