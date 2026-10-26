import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { invoiceDecisionReasons } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

// Starting reasons for approving a line in part or rejecting it
// (model/rules.yaml decide_invoice_lines). Configurable reference data:
// administrators add, rename and retire them in Settings. Each applies to
// approving in part, rejecting, or both.
export const RATE_REASON_CODE = 'rate_above_configured';
export const OTHER_REASON_CODE = 'other';

export type ReasonAppliesTo = 'approved_in_part' | 'rejected' | 'both';

export const INVOICE_DECISION_REASONS: Array<{ code: string; displayName: string; appliesTo: ReasonAppliesTo }> = [
  { code: RATE_REASON_CODE, displayName: 'Rate is higher than the pre-authorized rate', appliesTo: 'approved_in_part' },
  { code: 'not_billable', displayName: 'Part of the work is not billable', appliesTo: 'approved_in_part' },
  { code: 'excessive_time', displayName: 'More time than the task needs', appliesTo: 'approved_in_part' },
  { code: 'block_billing', displayName: 'Block billing. List the tasks separately.', appliesTo: 'rejected' },
  { code: 'not_provider_service', displayName: 'Not an investigator or expert service', appliesTo: 'rejected' },
  { code: 'no_backup', displayName: 'No back-up attached: receipt, map, or breakdown', appliesTo: 'rejected' },
  { code: 'duplicate', displayName: 'Duplicate of another entry', appliesTo: 'both' },
  { code: OTHER_REASON_CODE, displayName: 'Another reason. See the note.', appliesTo: 'both' },
];

export function reasonAppliesTo(appliesTo: string, outcome: 'approved_in_part' | 'rejected'): boolean {
  return appliesTo === 'both' || appliesTo === outcome;
}

// --- administration (Settings) ------------------------------------------------

const appliesToSchema = z.enum(['approved_in_part', 'rejected', 'both']);

// Every reason, retired ones too, in list order: "other" last.
export async function listDecisionReasons(db: DatabaseOrTransaction, options: { activeOnly?: boolean } = {}) {
  const rows = await db
    .select({
      reasonId: invoiceDecisionReasons.id,
      code: invoiceDecisionReasons.code,
      displayName: invoiceDecisionReasons.displayName,
      appliesTo: invoiceDecisionReasons.appliesTo,
      active: invoiceDecisionReasons.active,
    })
    .from(invoiceDecisionReasons)
    .where(options.activeOnly ? eq(invoiceDecisionReasons.active, true) : undefined)
    .orderBy(asc(invoiceDecisionReasons.displayName));
  return [...rows.filter((row) => row.code !== OTHER_REASON_CODE), ...rows.filter((row) => row.code === OTHER_REASON_CODE)];
}

export async function addDecisionReason(db: DatabaseOrTransaction, rawInput: unknown) {
  const input = z
    .object({ displayName: z.string().trim().min(3).max(120), appliesTo: appliesToSchema })
    .safeParse(rawInput);
  if (!input.success) {
    throw new ValidationError({ displayName: 'Write the reason as reviewers should see it.' });
  }
  const code = `custom_${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(invoiceDecisionReasons)
    .values({ code, displayName: input.data.displayName, appliesTo: input.data.appliesTo })
    .returning();
  return row;
}

// Renaming, moving between lists or retiring; retired reasons stay on the
// decisions that used them. "Other" can't be retired: it is the fallback.
export async function updateDecisionReason(db: DatabaseOrTransaction, reasonId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(reasonId).success) {
    throw new NotFoundError('Reason not found.');
  }
  const input = z
    .object({
      displayName: z.string().trim().min(3).max(120).optional(),
      appliesTo: appliesToSchema.optional(),
      active: z.boolean().optional(),
    })
    .safeParse(rawInput);
  if (!input.success) {
    throw new ValidationError({ displayName: 'Write the reason as reviewers should see it.' });
  }
  const [existing] = await db.select().from(invoiceDecisionReasons).where(eq(invoiceDecisionReasons.id, reasonId));
  if (!existing) {
    throw new NotFoundError('Reason not found.');
  }
  if (existing.code === OTHER_REASON_CODE && (input.data.active === false || (input.data.appliesTo && input.data.appliesTo !== 'both'))) {
    throw new ValidationError({ active: '"Another reason" stays on both lists.' });
  }
  const [row] = await db.update(invoiceDecisionReasons).set(input.data).where(eq(invoiceDecisionReasons.id, reasonId)).returning();
  return row;
}
