// Case numbers as senders type them: never checked against a list of
// cases, so the same case can be typed several ways. Invoices are compared
// exactly, and as close matches that ignore case, spaces, dashes and
// leading zeros (26-CR-0418 and 26cr00418).
import type { ParsedInvoice, SourceRegion } from '../imports/parsedInvoice';

// The number an invoice is filed and matched under: a reviewer's
// correction (./correctCaseNumber.ts), else what the sender typed.
export function currentCaseNumber(row: { caseNumberAsTyped: string | null; caseNumberCorrected: string | null }): string | null {
  return row.caseNumberCorrected ?? row.caseNumberAsTyped;
}

const MAX_LENGTH = 100;

// Trimmed with inner spaces collapsed; null when empty.
export function cleanCaseNumber(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
  return cleaned === '' ? null : cleaned;
}

function exactKey(value: string): string {
  return value.toUpperCase();
}

export function closeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
}

// "Case No. 26-CR-00418", "Court Case No(s).: …", "Case ID: …", "Docket #…".
// Within one line; the number must contain a digit, so a name isn't taken.
const LABELLED_CASE_NUMBER =
  /\b(court[ \t]+)?(?:case|docket|cause)[ \t]*(?:no|number|num|id|#)?(?:\(s\))?\.?[ \t]*[:#.]?[ \t]*([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)/gi;

// Every labelled number in the text, in order; court numbers marked.
export function labelledCaseNumbers(text: string | undefined): Array<{ value: string; court: boolean }> {
  return [...(text ?? '').matchAll(LABELLED_CASE_NUMBER)].flatMap((match) => {
    const value = match[2]!.length >= 4 ? cleanCaseNumber(match[2]) : null;
    return value ? [{ value, court: Boolean(match[1]) || /^(docket|cause)/i.test(match[0]) }] : [];
  });
}

// The court's number when the file labels one (G asks for the number on the
// court papers), else the first labelled one.
export function labelledCaseNumber(text: string | undefined): string | null {
  const found = labelledCaseNumbers(text);
  return (found.find((match) => match.court) ?? found[0])?.value ?? null;
}

// Where the extractor found one, else a labelled number in the file's
// text, else the one case label its lines share.
export function readCaseNumber(
  parsed: Pick<ParsedInvoice, 'invoiceText' | 'lines' | 'caseNumber'>,
): { value: string; region?: SourceRegion } | null {
  if (parsed.caseNumber) {
    return parsed.caseNumber;
  }
  const labelled = labelledCaseNumber(parsed.invoiceText);
  if (labelled) {
    return { value: labelled };
  }
  const labels = [...new Set(parsed.lines.flatMap((line) => (line.caseLabel ? [cleanCaseNumber(line.caseLabel)] : [])))];
  return labels.length === 1 && labels[0] && /\d/.test(labels[0]) ? { value: labels[0] } : null;
}

export interface CaseNumberMatches {
  // Other invoices with the same number, and with a close but different one.
  same: number;
  close: number;
}

export function matchCaseNumbers(entries: Array<{ invoiceId: string; caseNumber: string | null }>): Map<string, CaseNumberMatches> {
  const exact = new Map<string, number>();
  const close = new Map<string, number>();
  for (const { caseNumber } of entries) {
    if (caseNumber) {
      exact.set(exactKey(caseNumber), (exact.get(exactKey(caseNumber)) ?? 0) + 1);
      close.set(closeKey(caseNumber), (close.get(closeKey(caseNumber)) ?? 0) + 1);
    }
  }
  const result = new Map<string, CaseNumberMatches>();
  for (const { invoiceId, caseNumber } of entries) {
    if (caseNumber) {
      const same = exact.get(exactKey(caseNumber))!;
      result.set(invoiceId, { same: same - 1, close: close.get(closeKey(caseNumber))! - same });
    }
  }
  return result;
}
