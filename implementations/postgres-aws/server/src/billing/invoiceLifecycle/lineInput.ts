// A request's lines as sent (model/workflows.yaml payment_request).
import { z } from 'zod';
import { ConflictError, ValidationError } from '../../errors';
import { fieldErrorsFromZodIssues } from '../../intake/validation';
import { optionalEmail } from '../../people/emails';

// invoice_line_types codes; 'other' is the pre-existing 'service' type.
// Mileage is an expense line with the mileage expense type.
export const LINE_TYPE_CODES = { time: 'time', expense: 'expense', mileage: 'expense', other: 'service' } as const;
export type LineType = keyof typeof LINE_TYPE_CODES;
export const MILEAGE_EXPENSE_TYPE_CODE = 'mileage';

const address = z.string().trim().min(1).max(300);

export const invoiceLineInputSchema = z
  .object({
    lineType: z.enum(['time', 'expense', 'mileage', 'other']).optional(),
    // Ignored on a time or mileage line, which is priced from rates
    // (../priceLines.ts), except while an import is unconfirmed.
    amount: z.coerce.number().positive().optional(),
    // The billed professionals' time on this case; makes the line a time line.
    sourceTimeEntryId: z.string().uuid().optional(),
    serviceDate: z.iso.date().optional(),
    description: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().positive().optional(),
    // Supplier-stated; prices a time line in place of the configured rate.
    unitRate: z.coerce.number().nonnegative().optional(),
    statedAmount: z.coerce.number().nonnegative().optional(),
    timekeeperLabel: z.string().trim().min(1).optional(),
    taskCode: z.string().trim().min(1).optional(),
    activityCode: z.string().trim().min(1).optional(),
    expenseCode: z.string().trim().min(1).optional(),
    // Defaults to the billed professional on a delegated invoice.
    timekeeperProfessionalId: z.string().uuid().optional(),
    // Someone not listed, named by the submitter (../proposedDetails.ts).
    proposedTimekeeperName: z.string().trim().min(1).max(200).optional(),
    proposedTimekeeperEmail: optionalEmail,
    // Lines sharing a key are one trip (model/rules.yaml
    // apply_travel_time_rates): a time line on one is travel time. A mileage
    // line without one is a trip of its own. The trip's route is given on
    // each of its lines; the first line's governs.
    tripKey: z.string().trim().min(1).max(100).optional(),
    // A time line off a trip may be waiting time, priced at its own rate.
    timeCategory: z.literal('waiting').optional(),
    // A mileage line's quantity is the miles claimed for the whole trip.
    tripOrigin: address.optional(),
    tripDestination: address.optional(),
    roundTrip: z.boolean().optional(),
    // The imported file's line or row it was read from; carried back on save.
    sourceLocation: z.string().trim().min(1).max(200).optional(),
    // Keeps the saved line, with any decision or question on it; one not on
    // this invoice is a new line.
    invoiceLineId: z.uuid().optional(),
  })
  .transform((line) => ({
    ...line,
    lineType: (line.sourceTimeEntryId ? 'time' : (line.lineType ?? 'other')) as LineType,
  }))
  .refine((line) => line.lineType === 'time' || line.lineType === 'mileage' || line.amount !== undefined, {
    message: 'Each expense or other item needs an amount above zero.',
    path: ['amount'],
  })
  .refine((line) => !line.tripKey || line.lineType !== 'other', {
    message: 'A trip takes travel time, mileage and expenses only.',
    path: ['tripKey'],
  });

// A draft may start with no lines, as an invoice entered by hand does;
// submitting needs at least one.
export const draftContentSchema = z.object({
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
  lines: z.array(invoiceLineInputSchema),
});

export type DraftContent = z.infer<typeof draftContentSchema>;

export class InvoiceStateError extends ConflictError {
  constructor(message: string) {
    super('invalid_state', message);
  }
}

export function parseDraftContent(rawInput: unknown): DraftContent {
  const parsed = draftContentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const content = parsed.data;
  if (content.periodStart && content.periodEnd && content.periodEnd < content.periodStart) {
    throw new ValidationError({ periodEnd: 'The billing period cannot end before it starts.' });
  }
  const counts = new Map<string, { time: number; mileage: number }>();
  for (const line of content.lines) {
    if (!line.tripKey) continue;
    const count = counts.get(line.tripKey) ?? { time: 0, mileage: 0 };
    if (line.lineType === 'time') count.time += 1;
    if (line.lineType === 'mileage') count.mileage += 1;
    counts.set(line.tripKey, count);
  }
  if ([...counts.values()].some((count) => count.time > 1 || count.mileage > 1)) {
    throw new ValidationError({ lines: 'A trip has one travel time item and one mileage item at most.' });
  }
  return content;
}
