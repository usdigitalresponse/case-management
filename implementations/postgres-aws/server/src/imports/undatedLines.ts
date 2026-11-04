// Undated file lines take the previous line's date, flagged; with none they
// stay blank and must be dated to confirm or send (model/rules.yaml
// validate_invoice_import).
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoiceLine } from '../db/schema';
import { ValidationError } from '../errors';
import type { ImportWarning } from './parsedInvoice';

export const DATE_FROM_PREVIOUS_WARNING = 'date_from_previous_line';
export const DATE_MISSING_WARNING = 'date_missing';

// Lines in file order; filled dates carry on.
export function fillMissingDates(lines: Array<{ location: string; serviceDate?: string }>): {
  dates: Array<string | undefined>;
  warnings: ImportWarning[];
} {
  const warnings: ImportWarning[] = [];
  let previous: string | undefined;
  const dates = lines.map((line) => {
    if (line.serviceDate) {
      previous = line.serviceDate;
      return line.serviceDate;
    }
    warnings.push(
      previous
        ? {
            code: DATE_FROM_PREVIOUS_WARNING,
            location: line.location,
            message: `No date in the file, so it's set to the date of the line before it (${previous}). Check it.`,
          }
        : { code: DATE_MISSING_WARNING, location: line.location, message: "No date in the file. Enter this item's date." },
    );
    return previous;
  });
  return { dates, warnings };
}

export async function requireImportedDates(tx: Transaction, invoiceId: string): Promise<void> {
  const [undated] = await tx
    .select({ description: invoiceLine.description })
    .from(invoiceLine)
    .where(and(eq(invoiceLine.invoiceId, invoiceId), isNotNull(invoiceLine.sourceLocation), isNull(invoiceLine.serviceDate)))
    .orderBy(invoiceLine.position)
    .limit(1);
  if (undated) {
    const item = undated.description ? `"${undated.description}"` : 'An item';
    throw new ValidationError({ lines: `${item} has no date in the file. Enter its date.` });
  }
}
