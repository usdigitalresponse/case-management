// Who holds an invoice's line review and sign-off (model/rules.yaml
// assign_invoice_review). Reassigning ends the current row and starts
// another, so who held the invoice stays in history.
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import {
  caseInvoiceReviewer,
  invoice,
  invoiceApprovalStepTypes,
  invoiceReviewAssignment,
  invoiceStatuses,
  userAccount,
} from '../db/schema';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { loadReviewPermissions, requireReviewPermission } from './reviewAccess';
import { getReviewSettings } from './reviewSettings';
import { LINE_REVIEW_STATUS_CODES } from './invoiceStatusCodes';

export const LINE_REVIEW_STEP_TYPE_CODE = 'line_review';
export const SIGN_OFF_STEP_TYPE_CODE = 'sign_off';

export interface AssignedPerson {
  userAccountId: string;
  displayName: string;
}

export interface InvoiceAssignments {
  reviewer: AssignedPerson | null;
  signOff: Array<AssignedPerson & { position: number }>;
}

export async function loadAssignments(db: DatabaseOrTransaction, invoiceId: string): Promise<InvoiceAssignments> {
  const rows = await db
    .select({
      stepCode: invoiceApprovalStepTypes.code,
      position: invoiceReviewAssignment.position,
      userAccountId: invoiceReviewAssignment.assignedUserAccountId,
      displayName: userAccount.displayName,
    })
    .from(invoiceReviewAssignment)
    .innerJoin(invoiceApprovalStepTypes, eq(invoiceReviewAssignment.stepTypeId, invoiceApprovalStepTypes.id))
    .innerJoin(userAccount, eq(invoiceReviewAssignment.assignedUserAccountId, userAccount.userAccountId))
    .where(and(eq(invoiceReviewAssignment.invoiceId, invoiceId), isNull(invoiceReviewAssignment.endedAt)))
    .orderBy(asc(invoiceReviewAssignment.position));
  const reviewer = rows.find((row) => row.stepCode === LINE_REVIEW_STEP_TYPE_CODE);
  return {
    reviewer: reviewer ? { userAccountId: reviewer.userAccountId, displayName: reviewer.displayName } : null,
    signOff: rows
      .filter((row) => row.stepCode === SIGN_OFF_STEP_TYPE_CODE)
      .map(({ position, userAccountId, displayName }) => ({ position, userAccountId, displayName })),
  };
}

// The active line reviewer's name for each of several invoices.
export async function loadLineReviewerNames(db: DatabaseOrTransaction, invoiceIds: string[]): Promise<Map<string, string>> {
  if (invoiceIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ invoiceId: invoiceReviewAssignment.invoiceId, displayName: userAccount.displayName })
    .from(invoiceReviewAssignment)
    .innerJoin(invoiceApprovalStepTypes, eq(invoiceReviewAssignment.stepTypeId, invoiceApprovalStepTypes.id))
    .innerJoin(userAccount, eq(invoiceReviewAssignment.assignedUserAccountId, userAccount.userAccountId))
    .where(
      and(
        inArray(invoiceReviewAssignment.invoiceId, invoiceIds),
        isNull(invoiceReviewAssignment.endedAt),
        eq(invoiceApprovalStepTypes.code, LINE_REVIEW_STEP_TYPE_CODE),
      ),
    );
  return new Map(rows.map((row) => [row.invoiceId, row.displayName]));
}

async function stepTypeId(db: DatabaseOrTransaction, code: string): Promise<string> {
  return getReferenceId(db, invoiceApprovalStepTypes, code);
}

async function insertAssignment(
  tx: Transaction,
  values: { invoiceId: string; stepCode: string; position: number; userAccountId: string; byUserAccountId: string | null },
): Promise<void> {
  await tx.insert(invoiceReviewAssignment).values({
    invoiceId: values.invoiceId,
    stepTypeId: await stepTypeId(tx, values.stepCode),
    position: values.position,
    assignedUserAccountId: values.userAccountId,
    assignedAt: new Date(),
    assignedByUserAccountId: values.byUserAccountId,
  });
}

async function endAssignments(tx: Transaction, invoiceId: string, stepCode: string, byUserAccountId: string): Promise<void> {
  await tx
    .update(invoiceReviewAssignment)
    .set({ endedAt: new Date(), endedByUserAccountId: byUserAccountId })
    .where(
      and(
        eq(invoiceReviewAssignment.invoiceId, invoiceId),
        eq(invoiceReviewAssignment.stepTypeId, await stepTypeId(tx, stepCode)),
        isNull(invoiceReviewAssignment.endedAt),
      ),
    );
}

// A recalled invoice leaves review; it is routed afresh if submitted again.
export async function endAllAssignments(tx: Transaction, invoiceId: string, byUserAccountId: string): Promise<void> {
  await tx
    .update(invoiceReviewAssignment)
    .set({ endedAt: new Date(), endedByUserAccountId: byUserAccountId })
    .where(and(eq(invoiceReviewAssignment.invoiceId, invoiceId), isNull(invoiceReviewAssignment.endedAt)));
}

// On submission: the case's reviewer, else the default, else no one; the
// default sign-off approvers in order. Defaults that no longer have the
// role are skipped.
// With no case, only the default reviewer applies.
export async function assignOnSubmit(tx: Transaction, invoiceId: string, caseId: string | null): Promise<void> {
  const [settings, [caseReviewer]] = await Promise.all([
    getReviewSettings(tx),
    caseId === null
      ? Promise.resolve([])
      : tx
          .select({ userAccountId: caseInvoiceReviewer.reviewerUserAccountId })
          .from(caseInvoiceReviewer)
          .where(and(eq(caseInvoiceReviewer.caseId, caseId), isNull(caseInvoiceReviewer.endedAt))),
  ]);
  for (const candidate of [caseReviewer?.userAccountId, settings.defaultReviewerUserAccountId]) {
    // eslint-disable-next-line no-await-in-loop
    if (candidate && (await loadReviewPermissions(tx, candidate)).reviewLines) {
      // eslint-disable-next-line no-await-in-loop
      await insertAssignment(tx, { invoiceId, stepCode: LINE_REVIEW_STEP_TYPE_CODE, position: 1, userAccountId: candidate, byUserAccountId: null });
      break;
    }
  }
  await assignSignOff(tx, invoiceId, settings.defaultSignOffUserAccountIds, null);
}

async function assignSignOff(tx: Transaction, invoiceId: string, userAccountIds: string[], byUserAccountId: string | null) {
  let position = 1;
  for (const userAccountId of userAccountIds) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await loadReviewPermissions(tx, userAccountId)).signOff) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await insertAssignment(tx, { invoiceId, stepCode: SIGN_OFF_STEP_TYPE_CODE, position, userAccountId, byUserAccountId });
    position += 1;
  }
}

export async function lockInvoiceForReview(tx: Transaction, invoiceId: string) {
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const [locked] = await tx
    .select({ invoiceId: invoice.invoiceId, caseId: invoice.caseId, statusId: invoice.statusId, statusCode: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId))
    .for('update', { of: invoice });
  if (!locked) {
    throw new InvoiceNotFoundError();
  }
  return locked;
}

export class NotYourInvoiceError extends ConflictError {
  constructor(holder: string) {
    super('not_assigned', `${holder} is reviewing this invoice. Give it to yourself first.`);
  }
}

// Deciding a line on an unassigned invoice takes it.
export async function claimLineReview(tx: Transaction, invoiceId: string, actorUserAccountId: string): Promise<void> {
  const { reviewer } = await loadAssignments(tx, invoiceId);
  if (!reviewer) {
    await insertAssignment(tx, {
      invoiceId,
      stepCode: LINE_REVIEW_STEP_TYPE_CODE,
      position: 1,
      userAccountId: actorUserAccountId,
      byUserAccountId: actorUserAccountId,
    });
    return;
  }
  if (reviewer.userAccountId !== actorUserAccountId) {
    throw new NotYourInvoiceError(reviewer.displayName);
  }
}

const reassignInputSchema = z.object({
  userAccountId: z.uuid(),
  // Also send this case's future invoices to them.
  forCase: z.boolean().default(false),
});

// The actor may reassign, and the person given the work reviews invoices.
async function requireReviewerAssignment(db: Database, actorUserAccountId: string, reviewerUserAccountId: string) {
  const [, reviewer] = await Promise.all([
    requireReviewPermission(db, actorUserAccountId, 'reassign'),
    loadReviewPermissions(db, reviewerUserAccountId),
  ]);
  if (!reviewer.reviewLines) {
    throw new ValidationError({ userAccountId: 'Choose someone who reviews invoices.' });
  }
}

export async function reassignReviewer(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = reassignInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  await requireReviewerAssignment(db, actorUserAccountId, input.userAccountId);
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
      throw new ConflictError('invalid_state', 'Only an invoice waiting for review or being reviewed can be given to someone else.');
    }
    const { reviewer } = await loadAssignments(tx, invoiceId);
    if (reviewer?.userAccountId !== input.userAccountId) {
      await endAssignments(tx, invoiceId, LINE_REVIEW_STEP_TYPE_CODE, actorUserAccountId);
      await insertAssignment(tx, {
        invoiceId,
        stepCode: LINE_REVIEW_STEP_TYPE_CODE,
        position: 1,
        userAccountId: input.userAccountId,
        byUserAccountId: actorUserAccountId,
      });
    }
    if (input.forCase && locked.caseId) {
      await setCaseReviewerInTx(tx, locked.caseId, input.userAccountId, actorUserAccountId);
    }
    return loadAssignments(tx, invoiceId);
  });
}

async function setCaseReviewerInTx(tx: Transaction, caseId: string, reviewerUserAccountId: string, actorUserAccountId: string) {
  const now = new Date();
  const [current] = await tx
    .select()
    .from(caseInvoiceReviewer)
    .where(and(eq(caseInvoiceReviewer.caseId, caseId), isNull(caseInvoiceReviewer.endedAt)))
    .for('update');
  if (current?.reviewerUserAccountId === reviewerUserAccountId) {
    return;
  }
  if (current) {
    await tx
      .update(caseInvoiceReviewer)
      .set({ endedAt: now })
      .where(eq(caseInvoiceReviewer.caseInvoiceReviewerId, current.caseInvoiceReviewerId));
  }
  await tx.insert(caseInvoiceReviewer).values({ caseId, reviewerUserAccountId, setAt: now, setByUserAccountId: actorUserAccountId });
}

export async function setCaseReviewer(db: Database, actorUserAccountId: string, caseId: string, rawInput: unknown) {
  const parsed = z.object({ userAccountId: z.uuid() }).safeParse(rawInput);
  if (!parsed.success || !z.uuid().safeParse(caseId).success) {
    throw new ValidationError({ userAccountId: 'Choose someone who reviews invoices.' });
  }
  await requireReviewerAssignment(db, actorUserAccountId, parsed.data.userAccountId);
  await db.transaction((tx) => setCaseReviewerInTx(tx, caseId, parsed.data.userAccountId, actorUserAccountId));
  return loadCaseReviewer(db, caseId);
}

export async function loadCaseReviewer(db: DatabaseOrTransaction, caseId: string): Promise<AssignedPerson | null> {
  const [row] = await db
    .select({ userAccountId: caseInvoiceReviewer.reviewerUserAccountId, displayName: userAccount.displayName })
    .from(caseInvoiceReviewer)
    .innerJoin(userAccount, eq(caseInvoiceReviewer.reviewerUserAccountId, userAccount.userAccountId))
    .where(and(eq(caseInvoiceReviewer.caseId, caseId), isNull(caseInvoiceReviewer.endedAt)));
  return row ?? null;
}

const signOffInputSchema = z.object({ userAccountIds: z.array(z.uuid()).min(1).max(5) });

// The line reviewer (or an administrator) chooses who signs off, until the
// round is finished.
export async function setSignOffApprovers(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = signOffInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ userAccountIds: 'Choose at least one person to sign off.' });
  }
  const { userAccountIds } = parsed.data;
  if (new Set(userAccountIds).size !== userAccountIds.length) {
    throw new ValidationError({ userAccountIds: 'List each person once.' });
  }
  for (const id of userAccountIds) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await loadReviewPermissions(db, id)).signOff) {
      throw new ValidationError({ userAccountIds: 'Choose people who sign off invoices.' });
    }
  }
  const actorPermissions = await loadReviewPermissions(db, actorUserAccountId);
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
      throw new ConflictError('invalid_state', 'Who signs off can only change before the review is finished.');
    }
    // Like deciding a line, choosing approvers takes an unassigned invoice.
    if (actorPermissions.reviewLines && !(await loadAssignments(tx, invoiceId)).reviewer) {
      await claimLineReview(tx, invoiceId, actorUserAccountId);
    }
    const { reviewer } = await loadAssignments(tx, invoiceId);
    if (reviewer?.userAccountId !== actorUserAccountId && !actorPermissions.changeSettings) {
      throw new ConflictError('not_assigned', "Only the invoice's reviewer can change who signs off.");
    }
    await endAssignments(tx, invoiceId, SIGN_OFF_STEP_TYPE_CODE, actorUserAccountId);
    await assignSignOff(tx, invoiceId, userAccountIds, actorUserAccountId);
    return loadAssignments(tx, invoiceId);
  });
}
