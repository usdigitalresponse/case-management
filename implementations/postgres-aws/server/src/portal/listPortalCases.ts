// Cases the user's own professional profile, or anyone they act for as a
// delegate, is actively assigned to: the external user's entry point. Each
// case lists which of those professionals hold it, so the portal can show a
// section per person; a case shared by several appears in each section.
// Each case also flags, per professional, work not yet submitted for
// approval.
import { and, asc, eq, exists, inArray, isNull, not, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  caseAssignment,
  caseTable,
  caseStatuses,
  invoice,
  invoiceLine,
  invoiceStatuses,
  person,
  professional,
  timeEntry,
} from '../db/schema';
import { portalReadableInvoiceCondition } from '../billing/invoiceAccess';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { representedProfessionalIds, resolvePortalActor, type PortalActor } from './portalActor';

export interface PortalCaseProfessional {
  professionalId: string;
  displayName: string | null;
  isSelf: boolean;
}

export interface PortalCase {
  caseId: string;
  statusId: string;
  statusDisplayName: string | null;
  externalReference: string | null;
  clientDisplayName: string | null;
  // The earliest open assignment among the listed professionals.
  assignedAt: Date;
  assignedProfessionalIds: string[];
  // Time on no submitted invoice.
  unsubmittedTimeProfessionalIds: string[];
  // Draft or withdrawn invoices you can read, by whom they bill.
  unsubmittedInvoiceProfessionalIds: string[];
}

type CaseProfessionalPairs = Array<{ caseId: string; professionalId: string }>;

function unsubmittedTime(db: Database, professionalIds: string[], caseIds: string[]): Promise<CaseProfessionalPairs> {
  const onSubmittedInvoice = db
    .select({ invoiceLineId: invoiceLine.invoiceLineId })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(
      and(
        eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId),
        notInArray(invoiceStatuses.code, UNSUBMITTED_INVOICE_STATUS_CODES),
      ),
    );
  return db
    .selectDistinct({ caseId: timeEntry.caseId, professionalId: timeEntry.professionalId })
    .from(timeEntry)
    .where(
      and(
        inArray(timeEntry.professionalId, professionalIds),
        inArray(timeEntry.caseId, caseIds),
        not(exists(onSubmittedInvoice)),
      ),
    );
}

function unsubmittedInvoices(
  db: Database,
  reader: PortalActor,
  professionalIds: string[],
  caseIds: string[],
): Promise<CaseProfessionalPairs> {
  return db
    .selectDistinct({ caseId: invoice.caseId, professionalId: invoice.professionalId })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(
      and(
        inArray(invoice.caseId, caseIds),
        inArray(invoice.professionalId, professionalIds),
        inArray(invoiceStatuses.code, UNSUBMITTED_INVOICE_STATUS_CODES),
        portalReadableInvoiceCondition(db, reader),
      ),
    );
}

function idsByCase(pairs: CaseProfessionalPairs): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const { caseId, professionalId } of pairs) {
    result.set(caseId, [...(result.get(caseId) ?? []), professionalId]);
  }
  return result;
}

export async function listPortalCases(
  db: Database,
  userAccountId: string,
): Promise<{ professionals: PortalCaseProfessional[]; cases: PortalCase[] }> {
  const actor = await resolvePortalActor(db, userAccountId);
  const representedIds = (await representedProfessionalIds(db, userAccountId)).filter(
    (id) => id !== actor.professionalId,
  );
  const professionalIds = [...(actor.professionalId ? [actor.professionalId] : []), ...representedIds];
  if (professionalIds.length === 0) {
    return { professionals: [], cases: [] };
  }

  const names = await db
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, professionalIds));
  // Yourself first, then the people you act for by name.
  const professionals = names
    .map((row) => ({ ...row, isSelf: row.professionalId === actor.professionalId }))
    .sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) || (a.displayName ?? '').localeCompare(b.displayName ?? ''),
    );

  const rows = await db
    .select({
      caseId: caseTable.caseId,
      statusId: caseTable.statusId,
      statusDisplayName: caseStatuses.displayName,
      externalReference: caseTable.externalReference,
      // The submitter is doing work for this client — showing the name is the point, not a leak.
      clientDisplayName: person.displayName,
      assignedAt: caseAssignment.assignedAt,
      professionalId: caseAssignment.professionalId,
    })
    .from(caseAssignment)
    .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
    .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(and(inArray(caseAssignment.professionalId, professionalIds), isNull(caseAssignment.endedAt)))
    .orderBy(asc(caseAssignment.assignedAt));
  const byCase = new Map<string, PortalCase>();
  for (const { professionalId, ...row } of rows) {
    const existing = byCase.get(row.caseId);
    if (!existing) {
      byCase.set(row.caseId, {
        ...row,
        assignedProfessionalIds: [professionalId],
        unsubmittedTimeProfessionalIds: [],
        unsubmittedInvoiceProfessionalIds: [],
      });
    } else if (!existing.assignedProfessionalIds.includes(professionalId)) {
      existing.assignedProfessionalIds.push(professionalId);
    }
  }
  const caseIds = [...byCase.keys()];
  if (caseIds.length > 0) {
    const [time, invoices] = await Promise.all([
      unsubmittedTime(db, professionalIds, caseIds),
      unsubmittedInvoices(db, actor, professionalIds, caseIds),
    ]);
    for (const [caseId, ids] of idsByCase(time)) {
      byCase.get(caseId)!.unsubmittedTimeProfessionalIds = ids;
    }
    for (const [caseId, ids] of idsByCase(invoices)) {
      byCase.get(caseId)!.unsubmittedInvoiceProfessionalIds = ids;
    }
  }
  return { professionals, cases: [...byCase.values()] };
}
