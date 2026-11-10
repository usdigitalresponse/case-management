// What design I's case pages show beside each case: its number, who works on
// it, its pre-authorized amount and invoices waiting, and the latest changes
// across cases. Read-only.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import {
  caseAssignment,
  caseLifecycleEvent,
  caseLifecycleEventTypes,
  caseTable,
  invoice,
  invoiceEvent,
  invoiceEventTypes,
  invoiceStatuses,
  person,
  professional,
  userAccount,
} from '../db/schema';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { loadPreauthorizationSummaries } from '../billing/preauthorizations';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { fromCents, toCents } from '../billing/money';
import { hasLineReviewer } from './caseStage';

export interface CaseListExtras {
  caseNumber: string | null;
  workers: string[];
  // Every pre-authorization on the case added up; null with none.
  preauthorized: string | null;
  waiting: { count: number; total: string };
}

export async function loadCaseListExtras(db: DatabaseOrTransaction, caseIds: string[]): Promise<Map<string, CaseListExtras>> {
  const result = new Map<string, CaseListExtras>();
  if (caseIds.length === 0) return result;
  const [numbers, workers, waiting, preauthorizations] = await Promise.all([
    loadCaseNumbers(db, caseIds),
    db
      .select({ caseId: caseAssignment.caseId, name: professional.displayName })
      .from(caseAssignment)
      .innerJoin(professional, eq(caseAssignment.professionalId, professional.professionalId))
      .where(and(inArray(caseAssignment.caseId, caseIds), isNull(caseAssignment.endedAt))),
    db
      .select({ caseId: invoice.caseId, total: invoice.submittedTotal })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(and(inArray(invoice.caseId, caseIds), inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES))),
    Promise.all(caseIds.map(async (caseId) => [caseId, await loadPreauthorizationSummaries(db, caseId)] as const)),
  ]);
  const ceilings = new Map(preauthorizations);
  for (const caseId of caseIds) {
    const own = waiting.filter((row) => row.caseId === caseId);
    const summaries = (ceilings.get(caseId) ?? []).filter((summary) => summary.source === 'preauthorized');
    result.set(caseId, {
      caseNumber: numbers.get(caseId)?.caseNumber ?? null,
      workers: [...new Set(workers.filter((row) => row.caseId === caseId).flatMap((row) => (row.name ? [row.name] : [])))].sort(),
      preauthorized: summaries.length === 0 ? null : fromCents(summaries.reduce((sum, summary) => sum + toCents(summary.ceiling), 0)),
      waiting: { count: own.length, total: fromCents(own.reduce((sum, row) => sum + toCents(row.total), 0)) },
    });
  }
  return result;
}

// Invoice events worth showing on the overview, as words.
const SENT_CODES = ['submitted', 'released_to_review'];
const INVOICE_CHANGES: Record<string, string> = {
  submitted: 'sent for review',
  released_to_review: 'sent for review',
  matched_to_case: 'matched to this case',
  question_asked: 'question asked',
  question_answered: 'question answered',
  review_finished: 'review finished',
  sent_back: 'sent back to the reviewer',
  signed_off: 'signed off',
  approved: 'signed off',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface CaseChange {
  caseId: string;
  clientDisplayName: string | null;
  caseNumber: string | null;
  what: string;
  when: Date;
  by: string | null;
}

export async function loadRecentCaseChanges(db: DatabaseOrTransaction, limit = 8): Promise<CaseChange[]> {
  const [invoiceRows, caseRows] = await Promise.all([
    db
      .select({
        caseId: invoice.caseId,
        periodStart: invoice.periodStart,
        code: invoiceEventTypes.code,
        when: invoiceEvent.occurredAt,
        by: userAccount.displayName,
        unassigned: sql<boolean>`${inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES)} and not ${hasLineReviewer}`,
      })
      .from(invoiceEvent)
      .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
      .innerJoin(invoice, eq(invoiceEvent.invoiceId, invoice.invoiceId))
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .leftJoin(userAccount, eq(invoiceEvent.actorUserAccountId, userAccount.userAccountId))
      .where(and(isNotNull(invoice.caseId), inArray(invoiceEventTypes.code, Object.keys(INVOICE_CHANGES))))
      .orderBy(desc(invoiceEvent.occurredAt))
      .limit(limit),
    db
      .select({
        caseId: caseLifecycleEvent.caseId,
        type: caseLifecycleEventTypes.displayName,
        when: caseLifecycleEvent.recordedAt,
        by: userAccount.displayName,
      })
      .from(caseLifecycleEvent)
      .innerJoin(caseLifecycleEventTypes, eq(caseLifecycleEvent.eventTypeId, caseLifecycleEventTypes.id))
      .leftJoin(userAccount, eq(caseLifecycleEvent.actorUserAccountId, userAccount.userAccountId))
      .orderBy(desc(caseLifecycleEvent.recordedAt))
      .limit(limit),
  ]);
  const changes = [
    ...invoiceRows.map((row) => ({
      caseId: row.caseId!,
      what: `${row.periodStart ? `Invoice for ${MONTHS[Number(row.periodStart.slice(5, 7)) - 1]} ${row.periodStart.slice(0, 4)}` : 'An invoice'} ${
        SENT_CODES.includes(row.code) && row.unassigned ? 'sent, no reviewer assigned yet' : INVOICE_CHANGES[row.code]
      }`,
      when: row.when,
      by: row.by,
    })),
    ...caseRows.map((row) => ({ caseId: row.caseId, what: `Case ${row.type.toLowerCase()}`, when: row.when, by: row.by })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, limit);
  const caseIds = [...new Set(changes.map((change) => change.caseId))];
  if (caseIds.length === 0) return [];
  const [clients, numbers] = await Promise.all([
    db
      .select({ caseId: caseTable.caseId, name: person.displayName })
      .from(caseTable)
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .where(inArray(caseTable.caseId, caseIds)),
    loadCaseNumbers(db, caseIds),
  ]);
  const clientOf = new Map(clients.map((row) => [row.caseId, row.name]));
  return changes.map((change) => ({
    ...change,
    clientDisplayName: clientOf.get(change.caseId) ?? null,
    caseNumber: numbers.get(change.caseId)?.caseNumber ?? null,
  }));
}
