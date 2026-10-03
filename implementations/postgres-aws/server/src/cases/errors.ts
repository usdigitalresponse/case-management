// Shared across case-scoped actions (assignStaffToCase.ts, closeCase.ts)
// so ../routes/cases.ts can catch one error type instead of a different
// "case not found" class per action.
export class CaseNotFoundError extends Error {
  constructor() {
    super('Case not found.');
    this.name = 'CaseNotFoundError';
  }
}
