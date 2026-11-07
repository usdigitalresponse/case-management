// Administrators remove someone added by mistake; unsent invoices naming them
// are left with no one chosen (model/rules.yaml add_professional_without_login).
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { getReferenceId } from '../db/referenceLookups';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import {
  auditEvent,
  caseAssignment,
  caseParticipant,
  caseTable,
  invoice,
  invoiceApprovalChain,
  invoiceAttestation,
  invoiceEvent,
  invoiceEventTypes,
  invoiceImport,
  invoiceLine,
  invoiceLineTypes,
  person,
  personAffiliation,
  preauthorization,
  professional,
  professionalInvoiceReviewer,
  professionalRate,
  timeEntry,
  userAccount,
} from '../db/schema';
import { ConflictError, NotFoundError } from '../errors';
import { clearDecisions, decidedLineIds, entryIsOpen, lineValues, markLinesChanged } from '../billing/enterInReview';
import { priceLines } from '../billing/priceLines';
import { fillUnmatchedTimekeepers } from '../billing/timekeeperFallback';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../imports/importedTimeEntries';
import { recheckDuplicates } from '../imports/duplicateWarnings';

async function exists(query: Promise<unknown[]>): Promise<boolean> {
  return (await query).length > 0;
}

// What keeps them, in words, or none.
async function whatKeepsThem(tx: Transaction, row: { professionalId: string; personId: string; userAccountId: string | null }) {
  const { professionalId, personId } = row;
  const reasons: string[] = [];
  if (row.userAccountId || (await exists(tx.select({ id: userAccount.userAccountId }).from(userAccount).where(eq(userAccount.personId, personId)).limit(1)))) {
    reasons.push('they have signed in');
  }
  if (await exists(tx.select({ id: caseAssignment.professionalId }).from(caseAssignment).where(eq(caseAssignment.professionalId, professionalId)).limit(1))) {
    reasons.push('they are assigned to a case');
  }
  if (await exists(tx.select({ id: timeEntry.timeEntryId }).from(timeEntry).where(eq(timeEntry.professionalId, professionalId)).limit(1))) {
    reasons.push('they have recorded time');
  }
  if (await exists(tx.select({ id: preauthorization.professionalId }).from(preauthorization).where(eq(preauthorization.professionalId, professionalId)).limit(1))) {
    reasons.push('they have a pre-authorization');
  }
  const personNamed =
    (await exists(tx.select({ id: personAffiliation.personId }).from(personAffiliation).where(eq(personAffiliation.personId, personId)).limit(1))) ||
    (await exists(tx.select({ id: caseParticipant.personId }).from(caseParticipant).where(eq(caseParticipant.personId, personId)).limit(1))) ||
    (await exists(tx.select({ id: caseTable.caseId }).from(caseTable).where(eq(caseTable.clientId, personId)).limit(1))) ||
    (await exists(tx.select({ id: invoiceAttestation.attestorPersonId }).from(invoiceAttestation).where(eq(invoiceAttestation.attestorPersonId, personId)).limit(1)));
  if (personNamed) {
    reasons.push('they have a role on a case or signed an invoice');
  }
  return reasons;
}

// Invoices naming them, as sender or as who did a line's work.
async function invoicesNaming(tx: Transaction, professionalId: string) {
  const onLines = tx
    .select({ invoiceId: invoiceLine.invoiceId })
    .from(invoiceLine)
    .where(eq(invoiceLine.timekeeperProfessionalId, professionalId));
  return tx
    .select({ invoiceId: invoice.invoiceId, sender: invoice.professionalId, linesVersion: invoice.linesVersion })
    .from(invoice)
    .where(or(eq(invoice.professionalId, professionalId), inArray(invoice.invoiceId, onLines)))
    .for('update', { of: invoice });
}

// Ever sent (a recalled one is a draft again) or frozen by a finished round.
async function wasSent(tx: Transaction, invoiceId: string): Promise<boolean> {
  return (
    (await exists(
      tx
        .select({ id: invoiceEvent.invoiceEventId })
        .from(invoiceEvent)
        .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
        .where(and(eq(invoiceEvent.invoiceId, invoiceId), inArray(invoiceEventTypes.code, ['submitted', 'sent_for_matching'])))
        .limit(1),
    )) ||
    (await exists(
      tx
        .select({ id: invoiceApprovalChain.invoiceApprovalChainId })
        .from(invoiceApprovalChain)
        .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNotNull(invoiceApprovalChain.submissionSnapshot)))
        .limit(1),
    ))
  );
}

// Repriced without them; an open entry's decisions on changed lines are undone.
async function release(
  tx: Transaction,
  actorUserAccountId: string,
  professionalId: string,
  found: { invoiceId: string; sender: string | null; linesVersion: number },
) {
  const { invoiceId } = found;
  const sender = found.sender === professionalId ? null : found.sender;
  const open = await entryIsOpen(tx, invoiceId);
  const before = open ? await lineValues(tx, invoiceId) : new Map<string, string>();
  const timeTypeId = await getReferenceId(tx, invoiceLineTypes, 'time');
  // Priced at their rates: their own lines, and with them the sender, the unmatched.
  const theirs = await tx
    .update(invoiceLine)
    .set({ timekeeperProfessionalId: null })
    .where(and(eq(invoiceLine.invoiceId, invoiceId), eq(invoiceLine.timekeeperProfessionalId, professionalId)))
    .returning({ id: invoiceLine.invoiceLineId });
  const unmatched =
    sender === null
      ? await tx
          .select({ id: invoiceLine.invoiceLineId })
          .from(invoiceLine)
          .where(and(eq(invoiceLine.invoiceId, invoiceId), isNull(invoiceLine.timekeeperProfessionalId)))
      : [];
  const repriced = [...new Set([...theirs, ...unmatched].map((line) => line.id))];
  await tx.update(invoice).set({ professionalId: sender }).where(eq(invoice.invoiceId, invoiceId));
  // Pricing keeps an amount it can't redo, so their rate's is cleared first.
  if (repriced.length > 0) {
    await tx
      .update(invoiceLine)
      .set({ amount: sql`coalesce(${invoiceLine.statedAmount}, 0)`, billedRate: null, configuredRate: null })
      .where(and(inArray(invoiceLine.invoiceLineId, repriced), eq(invoiceLine.lineTypeId, timeTypeId)));
  }
  const imported = await findImportForInvoice(tx, invoiceId);
  const confirmed = !imported || imported.statusCode === CONFIRMED_IMPORT_STATUS_CODE;
  if (confirmed && sender) await fillUnmatchedTimekeepers(tx, invoiceId, sender);
  await priceLines(tx, invoiceId, { billedProfessionalId: sender, unmatchedMeansBilled: confirmed && sender !== null, strict: false });
  await recheckDuplicates(tx, invoiceId, sender);
  const after = await lineValues(tx, invoiceId);
  const [chain] = open
    ? await tx
        .select({ chainId: invoiceApprovalChain.invoiceApprovalChainId })
        .from(invoiceApprovalChain)
        .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)))
    : [];
  if (chain) {
    const changed = (await decidedLineIds(tx, chain.chainId)).filter((id) => before.get(id) !== after.get(id));
    await clearDecisions(tx, chain.chainId, changed);
  }
  // A page holding the lines as they were must reload before saving.
  await markLinesChanged(tx, invoiceId, actorUserAccountId, found.linesVersion);
}

// No reasons: they may still be removed or corrected.
export async function keptBecause(tx: Transaction, row: { professionalId: string; personId: string; userAccountId: string | null }) {
  const reasons = await whatKeepsThem(tx, row);
  const named = await invoicesNaming(tx, row.professionalId);
  for (const found of named) {
    // eslint-disable-next-line no-await-in-loop
    if (await wasSent(tx, found.invoiceId)) {
      reasons.push('they are on a sent invoice');
      break;
    }
  }
  return { reasons, named };
}

export async function lockProfessional(tx: Transaction, professionalId: string) {
  if (!z.uuid().safeParse(professionalId).success) return undefined;
  const [row] = await tx
    .select({
      professionalId: professional.professionalId,
      personId: professional.personId,
      userAccountId: professional.userAccountId,
      displayName: professional.displayName,
      professionalKindId: professional.professionalKindId,
      email: person.email,
    })
    .from(professional)
    .innerJoin(person, eq(professional.personId, person.personId))
    .where(eq(professional.professionalId, professionalId))
    .for('update', { of: professional });
  return row;
}

export async function removeProfessional(db: Database, actorUserAccountId: string, professionalId: string) {
  return db.transaction(async (tx) => {
    const row = await lockProfessional(tx, professionalId);
    if (!row) {
      throw new NotFoundError('No such person.');
    }
    const name = row.displayName ?? 'This person';
    const { reasons, named } = await keptBecause(tx, row);
    if (reasons.length > 0) {
      throw new ConflictError('in_use', `${name} can’t be removed, because ${reasons.join(' and ')}.`);
    }
    for (const found of named) {
      // eslint-disable-next-line no-await-in-loop
      await release(tx, actorUserAccountId, professionalId, found);
    }
    await tx.update(invoiceImport).set({ suggestedProfessionalId: null }).where(eq(invoiceImport.suggestedProfessionalId, professionalId));
    // Kept in the audit event, as removing them deletes these.
    const ownRates = await tx.delete(professionalRate).where(eq(professionalRate.professionalId, professionalId)).returning();
    const reviewers = await tx
      .delete(professionalInvoiceReviewer)
      .where(eq(professionalInvoiceReviewer.professionalId, professionalId))
      .returning();
    await tx.delete(professional).where(eq(professional.professionalId, professionalId));
    await tx.delete(person).where(eq(person.personId, row.personId));
    const releasedInvoiceIds = named.map((found) => found.invoiceId);
    await tx.insert(auditEvent).values({
      entityType: 'professional',
      entityId: professionalId,
      eventType: 'professional_removed',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: {
        displayName: row.displayName,
        email: row.email,
        professionalKindId: row.professionalKindId,
        personId: row.personId,
        ownRates,
        reviewers,
        releasedInvoiceIds,
      },
    });
    return { professionalId, releasedInvoiceIds };
  });
}
