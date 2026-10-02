// Invoice submission for the external portal. No approval workflow here —
// this only takes an invoice from nonexistent to "submitted"; reviewing/
// approving it (model/schema.yaml invoice_approval_chain) is a separate,
// not-yet-built pass (see ../../MAPPING.md). Amounts are vendor-entered
// per line, not derived from a rate: there's no billing-rate entity in
// scope, and a real external vendor invoice states what it's charging
// rather than recomputing it from logged hours.
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { invoice, invoiceLine, invoiceLineTypes, invoiceStatuses, timeEntry } from '../db/schema';
import { hasOpenAssignment, NotAssignedToCaseError } from './caseAssignmentAuthorization';

// Server-selected synthetic rows, the same pattern as
// ../intake/createCase.ts's OPENING_EVENT_TYPE_CODE: a single seeded line
// type/status exists today (see ../db/fixtures.ts), so the client doesn't
// need to pick one.
const SUBMITTED_INVOICE_STATUS_CODE = 'submitted';
const DEFAULT_INVOICE_LINE_TYPE_CODE = 'service';

const createInvoiceLineInputSchema = z.object({
  amount: z.coerce.number().positive(),
  // For context only (e.g. "this $400 covers these three time entries") —
  // not used to compute the amount. Must belong to the same caller and
  // case as the invoice; checked below, not just left to the FK.
  sourceTimeEntryId: z.string().uuid().optional(),
});

export const createInvoiceInputSchema = z.object({
  caseId: z.string().uuid(),
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
  lines: z.array(createInvoiceLineInputSchema).min(1),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export interface CreateInvoiceActor {
  userAccountId: string;
  professionalId: string;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  submittedTotal: string;
}

export class CreateInvoiceValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Invalid invoice');
    this.name = 'CreateInvoiceValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class CreateInvoiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateInvoiceConfigurationError';
  }
}

export async function createInvoice(
  db: Database,
  actor: CreateInvoiceActor,
  rawInput: unknown,
): Promise<CreateInvoiceResult> {
  const parsed = createInvoiceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CreateInvoiceValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;

  if (!(await hasOpenAssignment(db, actor.professionalId, input.caseId))) {
    throw new NotAssignedToCaseError();
  }

  const sourceTimeEntryIds = input.lines
    .map((line) => line.sourceTimeEntryId)
    .filter((id): id is string => id !== undefined);
  if (sourceTimeEntryIds.length > 0) {
    const ownedTimeEntries = await db
      .select({ timeEntryId: timeEntry.timeEntryId })
      .from(timeEntry)
      .where(
        and(
          inArray(timeEntry.timeEntryId, sourceTimeEntryIds),
          eq(timeEntry.professionalId, actor.professionalId),
          eq(timeEntry.caseId, input.caseId),
        ),
      );
    const ownedIds = new Set(ownedTimeEntries.map((row) => row.timeEntryId));
    if (sourceTimeEntryIds.some((id) => !ownedIds.has(id))) {
      throw new CreateInvoiceValidationError({
        lines: 'One or more sourceTimeEntryId values are not your own time entries on this case.',
      });
    }
  }

  const [[submittedStatus], [defaultLineType]] = await Promise.all([
    db.select().from(invoiceStatuses).where(eq(invoiceStatuses.code, SUBMITTED_INVOICE_STATUS_CODE)),
    db.select().from(invoiceLineTypes).where(eq(invoiceLineTypes.code, DEFAULT_INVOICE_LINE_TYPE_CODE)),
  ]);
  if (!submittedStatus) {
    throw new CreateInvoiceConfigurationError(
      `Missing required seeded invoice_statuses row with code "${SUBMITTED_INVOICE_STATUS_CODE}".`,
    );
  }
  if (!defaultLineType) {
    throw new CreateInvoiceConfigurationError(
      `Missing required seeded invoice_line_types row with code "${DEFAULT_INVOICE_LINE_TYPE_CODE}".`,
    );
  }

  // Each line is rounded to cents once, up front, and that same rounded
  // value is used both for the persisted invoice_line.amount and for the
  // total below — rounding the raw float sum separately from each
  // individually-rounded line (e.g. two lines of 10.005) can otherwise
  // leave the invoice's total off by a cent from the sum of its own lines.
  const roundedLines = input.lines.map((line) => ({
    ...line,
    amount: Math.round(line.amount * 100) / 100,
  }));

  // Computed from the lines, never trusted from the client (porting
  // model/rules.yaml validate_invoice_total's "calculate the total from
  // eligible invoice lines" — every line is eligible in this first pass).
  const submittedTotal = roundedLines.reduce((sum, line) => sum + line.amount, 0);

  return db.transaction(async (tx) => {
    const insertedInvoice = firstRow(
      await tx
        .insert(invoice)
        .values({
          submittedByUserAccountId: actor.userAccountId,
          professionalId: actor.professionalId,
          statusId: submittedStatus.id,
          submittedAt: new Date(),
          submittedTotal: submittedTotal.toFixed(2),
          caseId: input.caseId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        })
        .returning(),
    );

    await tx.insert(invoiceLine).values(
      roundedLines.map((line) => ({
        invoiceId: insertedInvoice.invoiceId,
        caseId: input.caseId,
        lineTypeId: defaultLineType.id,
        sourceTimeEntryId: line.sourceTimeEntryId,
        amount: line.amount.toFixed(2),
      })),
    );

    return { invoiceId: insertedInvoice.invoiceId, submittedTotal: insertedInvoice.submittedTotal };
  });
}
