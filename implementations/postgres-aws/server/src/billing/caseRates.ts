// A reviewer's changed rate beyond one line (model/rules.yaml set_case_rate): on this invoice's matching lines,
// or as the case's default for the person or their kind from a date (a new row, changing only this invoice's
// lines; no rate returns to the configured one). Either way the lines are decided at that rate.
import { z } from 'zod';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import {
  caseRate,
  caseTable,
  expenseTypes,
  invoice,
  invoiceApprovalOutcomes,
  invoiceDecisionReasons,
  invoiceLine,
  invoiceLineTypes,
  invoiceLineWorkingDecision,
  professional,
  professionalKinds,
  supportingInvoice,
  userAccount,
} from '../db/schema';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { requireReviewPermission } from './reviewAccess';
import { activeReasonId, beginLineChange, InvoiceLineNotFoundError, markUnderReview } from './reviewInvoiceLine';
import { OTHER_REASON_CODE } from './decisionReasons';
import { linesBlockedByTimeLog, TIME_LOG_BLOCKS_MESSAGE } from './reviewTimeLog';
import { caseRateRowOn, loadDefaultRates, rateTypeOf, type RateType } from './defaultRates';
import { fromCents, toCents } from './money';

const applyRateSchema = z.object({
  rate: z.union([z.null(), z.coerce.number().positive().max(100000)]),
  scope: z.enum(['matching', 'case']),
  target: z.enum(['person', 'kind']).optional(),
  effectiveFrom: z.iso.date().optional(),
  reasonCode: z.string().trim().min(1).optional(),
  note: z.string().trim().max(2000).optional(),
  timeLogOverride: z.string().trim().max(2000).optional(),
  // The latest case rate for this person or kind and type the page showed.
  basedOnCaseRateId: z.uuid().nullable().optional(),
  linesVersion: z.number().int().nonnegative().optional(),
});

export const CASE_RATE_CHANGED_MESSAGE = 'Someone else just changed this case rate. The page now shows the latest.';

export async function applyLineRate(db: Database, actorUserAccountId: string, invoiceId: string, invoiceLineId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(invoiceLineId).success) {
    throw new InvoiceLineNotFoundError();
  }
  const parsed = applyRateSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.rate === null && input.scope !== 'case') {
    throw new ValidationError({ rate: 'Enter the rate.' });
  }
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');

  return db.transaction(async (tx) => {
    const { locked, chainId } = await beginLineChange(tx, actorUserAccountId, invoiceId, input.linesVersion);
    const [header] = await tx
      .select({ caseId: invoice.caseId, professionalId: invoice.professionalId })
      .from(invoice)
      .where(eq(invoice.invoiceId, invoiceId));
    const rows = await tx
      .select({
        invoiceLineId: invoiceLine.invoiceLineId,
        lineTypeCode: invoiceLineTypes.code,
        expenseTypeCode: expenseTypes.code,
        tripId: invoiceLine.tripId,
        timeCategory: invoiceLine.timeCategory,
        timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
        serviceDate: invoiceLine.serviceDate,
        quantity: invoiceLine.quantity,
        billedRate: invoiceLine.billedRate,
        configuredRate: invoiceLine.configuredRate,
        decided: invoiceLineWorkingDecision.invoiceLineWorkingDecisionId,
      })
      .from(invoiceLine)
      .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
      .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
      .leftJoin(
        invoiceLineWorkingDecision,
        and(
          eq(invoiceLineWorkingDecision.invoiceLineId, invoiceLine.invoiceLineId),
          eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId),
        ),
      )
      .where(eq(invoiceLine.invoiceId, invoiceId));
    const lines = rows.map((line) => ({
      ...line,
      rateType: rateTypeOf(line),
      professionalId: rateProfessionalId(line, header!.professionalId),
      hasQuantity: line.quantity !== null && Number(line.quantity) > 0 && line.billedRate !== null,
    }));
    const chosen = lines.find((line) => line.invoiceLineId === invoiceLineId);
    if (!chosen) {
      throw new InvoiceLineNotFoundError();
    }
    if (!chosen.hasQuantity || !chosen.rateType || !chosen.serviceDate) {
      throw new ValidationError({ rate: 'Only a dated line priced by hours or miles has a rate to change.' });
    }
    const matching = lines.filter(
      (line) =>
        line.hasQuantity &&
        line.serviceDate !== null &&
        line.rateType === chosen.rateType &&
        line.professionalId === chosen.professionalId &&
        (line === chosen || !line.decided),
    );

    let applyTo = matching;
    let rateFor = (_line: (typeof lines)[number]): string | undefined => String(input.rate);
    let reasonCodeId: string | null = null;
    let setRateId: string | null = null;
    if (input.scope === 'case') {
      const caseId = header!.caseId;
      if (!caseId) {
        throw new ValidationError({ scope: 'Match this invoice to a case before setting its default rate.' });
      }
      reasonCodeId = await activeReasonId(tx, input.reasonCode, 'case_rate');
      if (input.reasonCode === OTHER_REASON_CODE && !input.note) {
        throw new ValidationError({ note: 'Explain the reason in the note.' });
      }
      const { kindOf } = await loadDefaultRates(tx, caseId, chosen.professionalId ? [chosen.professionalId] : []);
      const kindId = chosen.professionalId ? kindOf.get(chosen.professionalId) : null;
      if (!chosen.professionalId || (input.target === 'kind' && !kindId)) {
        throw new ValidationError({ target: input.target === 'kind' ? 'This person has no kind yet.' : 'Choose who did the work first.' });
      }
      const effectiveFrom = input.effectiveFrom ?? matching.map((line) => line.serviceDate!).sort()[0]!;
      if (effectiveFrom > chosen.serviceDate) {
        throw new ValidationError({ effectiveFrom: 'Start it on or before this line’s date.' });
      }
      const target =
        input.target === 'kind' ? { professionalId: null, professionalKindId: kindId! } : { professionalId: chosen.professionalId, professionalKindId: null };
      // Two people setting the same case rate at once: the second is refused.
      await tx.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, caseId)).for('update');
      const [latest] = await tx
        .select({ caseRateId: caseRate.caseRateId, effectiveFrom: caseRate.effectiveFrom, rate: caseRate.rate })
        .from(caseRate)
        .where(
          and(
            eq(caseRate.caseId, caseId),
            eq(caseRate.rateType, chosen.rateType),
            target.professionalId ? eq(caseRate.professionalId, target.professionalId) : isNull(caseRate.professionalId),
            target.professionalKindId ? eq(caseRate.professionalKindId, target.professionalKindId) : isNull(caseRate.professionalKindId),
          ),
        )
        .orderBy(desc(caseRate.recordedAt))
        .limit(1);
      if ((latest?.caseRateId ?? null) !== (input.basedOnCaseRateId ?? null)) {
        throw new ConflictError('case_rate_changed', CASE_RATE_CHANGED_MESSAGE);
      }
      if (input.rate === null && (!latest || latest.rate === null)) {
        throw new ValidationError({ rate: 'This case has no rate of its own to return from.' });
      }
      setRateId = firstRow(
        await tx
          .insert(caseRate)
          .values({
            caseId,
            ...target,
            rateType: chosen.rateType,
            rate: input.rate === null ? null : String(input.rate),
            replacedRate: chosen.configuredRate,
            effectiveFrom,
            reasonId: reasonCodeId,
            note: input.note || null,
            invoiceId,
            // A new rate from the same date replaces the one it corrects.
            correctsCaseRateId: latest && latest.effectiveFrom === effectiveFrom ? latest.caseRateId : null,
            recordedByUserAccountId: actorUserAccountId,
            recordedAt: new Date(),
          })
          .returning({ caseRateId: caseRate.caseRateId }),
      ).caseRateId;
      const { resolve, caseRates } = await loadDefaultRates(tx, caseId, [chosen.professionalId]);
      const targetKey = target.professionalId ? { professionalId: target.professionalId } : { professionalKindId: target.professionalKindId! };
      // The new row is in force for its target on the line's date, and a rate for
      // the person themselves doesn't override one for their kind.
      const governed = lines.filter(
        (line) =>
          line.rateType === chosen.rateType &&
          line.professionalId === chosen.professionalId &&
          line.serviceDate !== null &&
          caseRateRowOn(caseRates, targetKey, line.rateType!, line.serviceDate)?.caseRateId === setRateId &&
          (target.professionalId !== null || resolve(line.professionalId, line.rateType!, line.serviceDate)?.source !== 'case_person'),
      );
      for (const line of governed) {
        const byDefault = resolve(line.professionalId, line.rateType!, line.serviceDate!);
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(invoiceLine)
          .set({ configuredRate: byDefault?.rate ?? null, rateSource: byDefault?.source ?? null, caseRateId: byDefault?.caseRateId ?? null })
          .where(eq(invoiceLine.invoiceLineId, line.invoiceLineId));
      }
      if (!governed.includes(chosen)) {
        throw new ValidationError({ target: 'A case rate for this person comes first. Set the rate for them instead.' });
      }
      applyTo = matching.filter((line) => governed.includes(line));
      rateFor = (line) => resolve(line.professionalId, line.rateType!, line.serviceDate!)?.rate;
    }

    // Others the time log blocks are left to decide one by one, as repricing does.
    const blocked = await linesBlockedByTimeLog(tx, invoiceId, applyTo.map((line) => line.invoiceLineId));
    if (blocked.has(chosen.invoiceLineId) && !input.timeLogOverride) {
      throw new ValidationError({ timeLogOverride: TIME_LOG_BLOCKS_MESSAGE });
    }
    const decide = applyTo.filter((line) => (line === chosen || !blocked.has(line.invoiceLineId)) && rateFor(line) !== undefined);
    const outcomeId = await getReferenceId(tx, invoiceApprovalOutcomes, 'approved');
    const decidedAt = new Date();
    for (const line of decide) {
      const rate = rateFor(line)!;
      const values = {
        outcomeId,
        approvedAmount: fromCents(toCents(Number(line.quantity) * Number(rate))),
        approvedQuantity: line.quantity,
        approvedRate: rate,
        reasonCodeId,
        note: input.note || null,
        timeLogOverride: line === chosen && blocked.has(line.invoiceLineId) ? input.timeLogOverride! : null,
        decidedByUserAccountId: actorUserAccountId,
        decidedAt,
      };
      // eslint-disable-next-line no-await-in-loop
      await tx
        .insert(invoiceLineWorkingDecision)
        .values({ invoiceApprovalChainId: chainId, invoiceLineId: line.invoiceLineId, ...values })
        .onConflictDoUpdate({
          target: [invoiceLineWorkingDecision.invoiceApprovalChainId, invoiceLineWorkingDecision.invoiceLineId],
          set: values,
        });
    }
    await markUnderReview(tx, invoiceId, locked.statusCode, actorUserAccountId, chainId);
    return { invoiceId, decided: decide.length, caseRateId: setRateId };
  });
}

// Whose rate prices a line: a time line's worker, else the invoice's; mileage is the invoice's.
export function rateProfessionalId(
  line: { expenseTypeCode: string | null; timekeeperProfessionalId: string | null },
  invoiceProfessionalId: string | null,
): string | null {
  return line.expenseTypeCode === 'mileage' ? invoiceProfessionalId : (line.timekeeperProfessionalId ?? invoiceProfessionalId);
}

export interface CaseRateView {
  caseRateId: string;
  professionalId: string | null;
  professionalDisplayName: string | null;
  professionalKindId: string | null;
  kindDisplayName: string | null;
  rateType: RateType;
  // Null: back to the configured rate.
  rate: string | null;
  replacedRate: string | null;
  effectiveFrom: string;
  reasonDisplayName: string;
  note: string | null;
  invoiceId: string;
  invoiceNumber: string | null;
  correctsCaseRateId: string | null;
  recordedByDisplayName: string;
  recordedAt: Date;
  // The row in force today for its person or kind and type.
  inForce: boolean;
}

// Every case rate, by date of work then as recorded. Staff only.
export async function loadCaseRateViews(db: DatabaseOrTransaction, caseId: string | null): Promise<CaseRateView[]> {
  if (!caseId) return [];
  const rows = await db
    .select({
      caseRateId: caseRate.caseRateId,
      professionalId: caseRate.professionalId,
      professionalDisplayName: professional.displayName,
      professionalKindId: caseRate.professionalKindId,
      kindDisplayName: professionalKinds.displayName,
      rateType: caseRate.rateType,
      rate: caseRate.rate,
      replacedRate: caseRate.replacedRate,
      effectiveFrom: caseRate.effectiveFrom,
      reasonDisplayName: invoiceDecisionReasons.displayName,
      note: caseRate.note,
      invoiceId: caseRate.invoiceId,
      invoiceNumber: supportingInvoice.invoiceNumber,
      correctsCaseRateId: caseRate.correctsCaseRateId,
      recordedByDisplayName: userAccount.displayName,
      recordedAt: caseRate.recordedAt,
    })
    .from(caseRate)
    .leftJoin(professional, eq(caseRate.professionalId, professional.professionalId))
    .leftJoin(professionalKinds, eq(caseRate.professionalKindId, professionalKinds.id))
    .innerJoin(invoiceDecisionReasons, eq(caseRate.reasonId, invoiceDecisionReasons.id))
    .innerJoin(userAccount, eq(caseRate.recordedByUserAccountId, userAccount.userAccountId))
    .leftJoin(supportingInvoice, eq(supportingInvoice.invoiceId, caseRate.invoiceId))
    .where(eq(caseRate.caseId, caseId))
    .orderBy(asc(caseRate.effectiveFrom), asc(caseRate.recordedAt));
  const today = new Date().toISOString().slice(0, 10);
  const inForce = new Map<string, string>();
  for (const row of rows) {
    if (row.effectiveFrom <= today) {
      inForce.set(`${row.professionalId}|${row.professionalKindId}|${row.rateType}`, row.caseRateId);
    }
  }
  return rows.map((row) => ({
    ...row,
    rateType: row.rateType as RateType,
    inForce: inForce.get(`${row.professionalId}|${row.professionalKindId}|${row.rateType}`) === row.caseRateId,
  }));
}

// Case rates that would now give one of an invoice's lines another default,
// as when one changes after it was sent or it is matched to a case later.
// Its lines keep theirs; rates set while reviewing it are already on them.
export function caseRatesChangedSince(
  views: CaseRateView[],
  lines: Array<{ professionalId: string | null; kindId: string | null; rateType: RateType | null; serviceDate: string | null; caseRateId: string | null }>,
): CaseRateView[] {
  const changed = new Set<CaseRateView>();
  for (const line of lines) {
    if (!line.rateType || !line.serviceDate) continue;
    const own = line.professionalId ? caseRateRowOn(views, { professionalId: line.professionalId }, line.rateType, line.serviceDate) : undefined;
    const byKind = line.kindId ? caseRateRowOn(views, { professionalKindId: line.kindId }, line.rateType, line.serviceDate) : undefined;
    const governing = own?.rate != null ? own : byKind?.rate != null ? byKind : (own ?? byKind);
    if (governing && governing.caseRateId !== line.caseRateId && !(governing.rate === null && line.caseRateId === null)) {
      changed.add(governing as CaseRateView);
    }
  }
  return [...changed];
}
