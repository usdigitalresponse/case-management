// The figures behind "Check the lines": each line's amount as the server will
// bill it, the lines read from the file, and the notice comparing the two.
import type { BillableProfessional, FileLine, FileSource, MileageRate, TimeCategoryRate } from '../api/client';
import { emptyLine, hasInvoiceItems, isTimeKind, mileageItemPreview, timeItemPreview, timeKindPreview, travelItemPreview, type LineDraft } from '../invoiceLines';
import { readLineType, type LineValues, type Row } from '../fileChanges';
import { cents, formatMoney, sumMoney } from '../formatMoney';

export interface PricingContext {
  timekeepers: BillableProfessional[];
  billedProfessionalId: string | undefined;
  mileageRates: MileageRate[];
  timeCategoryRates: TimeCategoryRate[];
}

// Lines here are rows of their own, never a whole trip.
export function valuesOf(draft: LineDraft): LineValues {
  return {
    lineType: draft.lineType === 'travel' ? 'mileage' : draft.lineType === 'waiting' ? 'time' : draft.lineType,
    serviceDate: draft.serviceDate || null,
    description: draft.description || null,
    quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : null,
    unitRate: draft.carried.unitRate ?? null,
    amount: Number(draft.amount) > 0 ? Number(draft.amount) : null,
  };
}

// What a line bills and at what rate; null while it can't be priced yet.
export function priceOf(draft: LineDraft, context: PricingContext): { total: number | null; rate: string | null; missing?: string } {
  if (draft.lineType === 'travel') {
    const preview = travelItemPreview(draft, context.timekeepers, context.billedProfessionalId, context.mileageRates, context.timeCategoryRates);
    const missing = [preview.time, preview.mileage].flatMap((part) => (part && 'missing' in part ? [part.missing] : []));
    if (!hasInvoiceItems([draft])) {
      return { total: null, rate: null, missing: 'Add travel hours, miles or a cost' };
    }
    return missing.length > 0
      ? { total: null, rate: null, missing: missing.join('; ') }
      : { total: (preview.timeCents + preview.otherCents) / 100, rate: null };
  }
  if (isTimeKind(draft.lineType)) {
    // A time line on a trip is travel time.
    const preview = draft.tripKey
      ? timeItemPreview(draft, context.timekeepers, context.billedProfessionalId, { category: 'travel', rates: context.timeCategoryRates })
      : timeKindPreview(draft, context.timekeepers, context.billedProfessionalId, context.timeCategoryRates);
    return 'amount' in preview ? { total: Number(preview.amount), rate: preview.rate } : { total: null, rate: null, missing: preview.missing };
  }
  if (draft.lineType === 'mileage') {
    const preview = mileageItemPreview(draft, context.mileageRates);
    return 'amount' in preview ? { total: Number(preview.amount), rate: preview.rate } : { total: null, rate: null, missing: preview.missing };
  }
  const amount = Number(draft.amount);
  return amount > 0 ? { total: amount, rate: null } : { total: null, rate: null, missing: 'Add the amount' };
}

// A line as read from the file, to put back or start an undo from.
export function draftFromRead(read: FileLine, billedProfessionalId: string | undefined): LineDraft {
  return {
    ...emptyLine,
    lineType: readLineType(read),
    serviceDate: read.serviceDate ?? '',
    description: read.description ?? '',
    quantity: read.quantity === null ? '' : String(read.quantity),
    amount: read.amount === null ? '' : String(read.amount),
    timekeeperProfessionalId: billedProfessionalId ?? '',
    carried: {
      unitRate: read.unitRate ?? undefined,
      statedAmount: read.amount ?? undefined,
      sourceLocation: read.location,
    },
  };
}


export interface TotalsNotice {
  tone: 'success' | 'warning' | 'info';
  text: string;
}

const lineList = (numbers: number[]) =>
  numbers.length === 1 ? `line ${numbers[0]}` : `lines ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;

// The notice above the lines: the file's total beside the lines', and why
// they differ when the changes of whoever is entering it explain it.
export function totalsNotice({
  source,
  askingFor,
  removed,
  changed,
  added,
  duplicates,
  warningLine,
  ownFile = true,
}: {
  source: FileSource | null;
  askingFor: number | null;
  removed: number[];
  changed: number[];
  added: number[];
  duplicates: Map<number, number>;
  // The first line a reading warning names, with its message.
  warningLine: { number: number; message: string } | null;
  // False for staff entering someone else's invoice.
  ownFile?: boolean;
}): TotalsNotice | null {
  if (!source || askingFor === null) {
    return null;
  }
  const file = ownFile ? 'your file' : 'the file';
  const File = ownFile ? 'Your file' : 'The file';
  const readTotal = sumMoney(source.lines.map((line) => line.amount ?? 0));
  const fileSays = source.statedTotal ?? readTotal;
  const firstDuplicate = [...duplicates.entries()][0];
  const duplicateHint = firstDuplicate ? ` Check line ${firstDuplicate[0]}: it looks the same as line ${firstDuplicate[1]}.` : '';
  // The file's own lines don't add up to its total: something was misread.
  if (cents(fileSays) !== cents(readTotal) && removed.length + changed.length + added.length === 0) {
    const difference = Math.abs(readTotal - fileSays);
    const check = warningLine ? ` Check line ${warningLine.number}: ${warningLine.message.charAt(0).toLowerCase()}${warningLine.message.slice(1)}` : '';
    return {
      tone: 'warning',
      text: `${File} says the total is ${formatMoney(fileSays)}. The lines read from it add up to ${formatMoney(readTotal)}, which is ${formatMoney(difference)} ${readTotal > fileSays ? 'more' : 'less'}.${check}`,
    };
  }
  if (cents(askingFor) === cents(fileSays)) {
    return {
      tone: 'success',
      text: `The lines add up to ${formatMoney(askingFor)}, the same as the total on ${file}.${duplicateHint}`,
    };
  }
  const reasons = [
    removed.length > 0 ? `you removed ${lineList(removed)}` : null,
    changed.length > 0 ? `you changed ${lineList(changed)}` : null,
    added.length > 0 ? `you added ${lineList(added)}` : null,
  ].filter(Boolean);
  const difference = Math.abs(askingFor - fileSays);
  return {
    tone: reasons.length > 0 ? 'success' : 'warning',
    text:
      `${ownFile ? 'Your lines' : 'The lines'} add up to ${formatMoney(askingFor)}. That is ${formatMoney(difference)} ${askingFor > fileSays ? 'more' : 'less'} than ${file}` +
      (reasons.length > 0
        ? `, because ${reasons.join(' and ')}. ${ownFile ? 'Reviewers will see your file and every change you made.' : 'The file and every change stay on the invoice.'}`
        : '.') +
      duplicateHint,
  };
}

// Row numbers by what happened to each line.
export function rowChanges<L>(rows: Array<Row<L>>, isChanged: (row: Extract<Row<L>, { kind: 'line' }>) => boolean) {
  return {
    removed: rows.filter((row) => row.kind === 'removed').map((row) => row.number),
    changed: rows.filter((row): row is Extract<Row<L>, { kind: 'line' }> => row.kind === 'line' && Boolean(row.read) && isChanged(row)).map((row) => row.number),
    added: rows.filter((row) => row.kind === 'line' && !row.read).map((row) => row.number),
  };
}
