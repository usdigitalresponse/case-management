// Shared by the invoice import steps (model/workflows.yaml invoice_import).
import { type DatabaseOrTransaction } from '../../db/client';
import { getReferenceId } from '../../db/referenceLookups';
import { invoiceImportStatuses } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { UNRESOLVED_IMPORT_STATUS_CODES } from '../importedTimeEntries';
import { DATE_FROM_PREVIOUS_WARNING, DATE_MISSING_WARNING } from '../undatedLines';

export const UNRESOLVED_STATUS_CODES = UNRESOLVED_IMPORT_STATUS_CODES;
// With the codes imports wrote before migration 0026.
export const DATE_CHECK_CODES = [DATE_FROM_PREVIOUS_WARNING, 'date_from_period'];
export const DATE_CODES = [...DATE_CHECK_CODES, DATE_MISSING_WARNING, 'date_not_inferred'];

export class InvoiceImportNotFoundError extends NotFoundError {
  constructor() {
    super('Import not found.');
  }
}

export function importStatusId(db: DatabaseOrTransaction, code: string): Promise<string> {
  return getReferenceId(db, invoiceImportStatuses, code);
}
