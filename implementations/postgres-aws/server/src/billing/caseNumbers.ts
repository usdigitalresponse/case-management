// Case numbers as senders type them, never checked against a list of cases.
// Close matches ignore case, spaces, dashes and leading zeros.
import { z } from 'zod';
import type { ParsedInvoice, SourceRegion } from '../imports/parsedInvoice';

export const caseNumberInput = z.string().max(100, 'Keep the case number under 100 characters.');

// A reviewer's correction (./correctCaseNumber.ts), else what the sender typed.
export function currentCaseNumber(row: { caseNumberAsTyped: string | null; caseNumberCorrected: string | null }): string | null {
  return row.caseNumberCorrected ?? row.caseNumberAsTyped;
}

// Trimmed with inner spaces collapsed; null when empty.
export function cleanCaseNumber(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  return cleaned === '' ? null : cleaned;
}

export const exactKey = (value: string) => value.toUpperCase();

// ASCII letters and digits only, as the database's case_number_close_key (migration 0042) computes it.
export function closeKey(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase()
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
}

// "Case No. 26-CR-00418", "Court Case No(s).: …", "Case ID: …", "Docket #…",
// within one line. The number needs a digit, so a name isn't taken.
const LABELLED_CASE_NUMBER =
  /\b(court[ \t]+)?(?:case|docket|cause)[ \t]*(?:no|number|num|id|#)?(?:\(s\))?\.?[ \t]*[:#.]?[ \t]*([A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*)/gi;

export function labelledCaseNumbers(text: string | undefined): Array<{ value: string; court: boolean }> {
  return [...(text ?? '').matchAll(LABELLED_CASE_NUMBER)].flatMap((match) => {
    const value = match[2]!.length >= 4 ? cleanCaseNumber(match[2]) : null;
    return value ? [{ value, court: Boolean(match[1]) || /^(docket|cause)/i.test(match[0]) }] : [];
  });
}

// The court's number first: senders are asked for the one on their court papers.
export function labelledCaseNumber(text: string | undefined): string | null {
  const found = labelledCaseNumbers(text);
  return (found.find((match) => match.court) ?? found[0])?.value ?? null;
}

// Where the PDF reader found one, else a labelled number in the text, else
// the one case label every line shares.
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

// A search hit: exact on a name or the number as written, else close.
export function searchMatch(query: string, names: Array<string | null>, caseNumber: string | null): 'exact' | 'close' | null {
  const words = query.trim().toLowerCase();
  if (!words) return null;
  if (names.join(' ').toLowerCase().includes(words) || caseNumber?.toLowerCase().includes(words)) return 'exact';
  const key = closeKey(query);
  return key && caseNumber && closeKey(caseNumber).includes(key) ? 'close' : null;
}

// Other invoices with the same number, and with a close but different one.
export interface CaseNumberMatches {
  same: number;
  close: number;
}
