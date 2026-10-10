// Creates time entries from a confirmed import's time lines on submission
// (model/rules.yaml create_time_entries_from_import).
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { DatabaseOrTransaction, Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { firstRow } from '../db/rowHelpers';
import {
  activityTypes,
  invoiceImport,
  invoiceImportStatuses,
  invoiceLine,
  invoiceLineTypes,
  timeEntry,
} from '../db/schema';

export const CONFIRMED_IMPORT_STATUS_CODE = 'confirmed';

// No mapping from supplier activity codes yet.
const IMPORTED_TIME_ACTIVITY_TYPE_CODE = 'legal_services';

export async function findImportForInvoice(db: DatabaseOrTransaction, invoiceId: string) {
  const [row] = await db
    .select({ invoiceImportId: invoiceImport.invoiceImportId, statusCode: invoiceImportStatuses.code })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .where(eq(invoiceImport.invoiceId, invoiceId));
  return row;
}

export async function createTimeEntriesFromImportedLines(
  tx: Transaction,
  invoiceId: string,
  invoiceImportId: string,
  caseId: string,
): Promise<void> {
  const lines = await tx
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      professionalId: invoiceLine.timekeeperProfessionalId,
      serviceDate: invoiceLine.serviceDate,
      quantity: invoiceLine.quantity,
      description: invoiceLine.description,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .where(
      and(
        eq(invoiceLine.invoiceId, invoiceId),
        eq(invoiceLineTypes.code, 'time'),
        isNull(invoiceLine.sourceTimeEntryId),
        isNotNull(invoiceLine.timekeeperProfessionalId),
        isNotNull(invoiceLine.serviceDate),
        gt(invoiceLine.quantity, '0'),
      ),
    );
  if (lines.length === 0) {
    return;
  }
  const activityTypeId = await getReferenceId(tx, activityTypes, IMPORTED_TIME_ACTIVITY_TYPE_CODE);

  for (const line of lines) {
    const professionalId = line.professionalId as string;
    const activityOn = line.serviceDate as string;
    const durationHours = line.quantity as string;
    // Resubmitting after a recall reuses this import's earlier entry.
    // eslint-disable-next-line no-await-in-loop
    const [existing] = await tx
      .select({ timeEntryId: timeEntry.timeEntryId })
      .from(timeEntry)
      .where(
        and(
          eq(timeEntry.sourceInvoiceImportId, invoiceImportId),
          eq(timeEntry.professionalId, professionalId),
          eq(timeEntry.caseId, caseId),
          eq(timeEntry.activityOn, activityOn),
          eq(timeEntry.durationHours, durationHours),
        ),
      );
    const timeEntryId =
      existing?.timeEntryId ??
      firstRow(
        // eslint-disable-next-line no-await-in-loop
        await tx
          .insert(timeEntry)
          .values({
            caseId,
            professionalId,
            activityTypeId,
            activityOn,
            durationHours,
            description: line.description ?? 'Imported time',
            sourceInvoiceImportId: invoiceImportId,
          })
          .returning({ timeEntryId: timeEntry.timeEntryId }),
      ).timeEntryId;
    // eslint-disable-next-line no-await-in-loop
    await tx.update(invoiceLine).set({ sourceTimeEntryId: timeEntryId }).where(eq(invoiceLine.invoiceLineId, line.invoiceLineId));
  }
}
