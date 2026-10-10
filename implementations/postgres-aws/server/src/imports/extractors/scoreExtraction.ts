// Field-by-field accuracy against scenarios/fixtures/invoices/expected.json,
// for comparing extraction methods.
import type { ParsedInvoice, ParsedLine } from '../parsedInvoice';

export interface ExpectedLine {
  lineType: string;
  serviceDate?: string;
  timekeeper?: string;
  description: string;
  quantity?: number;
  unitRate?: number;
  amount: string;
}

export interface ExpectedDocument {
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  statedTotal: string;
  lines: ExpectedLine[];
}

export interface ExtractionScore {
  correct: number;
  total: number;
  accuracy: number;
  lineCountMatches: boolean;
  misses: string[];
}

const words = (text: string | undefined) => (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameNumber = (a: number | string | undefined, b: number | string | undefined) =>
  a === undefined || b === undefined ? a === b : Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

const LINE_FIELDS: Array<[string, (expected: ExpectedLine, actual: ParsedLine | undefined) => boolean]> = [
  ['type', (e, a) => a?.lineType === e.lineType],
  ['date', (e, a) => a?.serviceDate === e.serviceDate],
  ['timekeeper', (e, a) => words(a?.timekeeperLabel) === words(e.timekeeper)],
  ['description', (e, a) => words(a?.description) === words(e.description)],
  ['hours', (e, a) => sameNumber(a?.quantity, e.quantity)],
  ['rate', (e, a) => sameNumber(a?.unitRate, e.unitRate)],
  ['amount', (e, a) => sameNumber(a?.amount, e.amount)],
];

// Compared in order: a missing or extra line costs every field after it.
export function scoreExtraction(expected: ExpectedDocument, actual: ParsedInvoice): ExtractionScore {
  const checks: Array<[string, boolean]> = [
    ['invoice number', actual.invoiceNumber === expected.invoiceNumber],
    ['period start', actual.periodStart === expected.periodStart],
    ['period end', actual.periodEnd === expected.periodEnd],
    ['stated total', sameNumber(actual.statedTotal, expected.statedTotal)],
  ];
  const lineCount = Math.max(expected.lines.length, actual.lines.length);
  for (let index = 0; index < lineCount; index += 1) {
    const expectedLine = expected.lines[index];
    const actualLine = actual.lines[index];
    for (const [field, matches] of LINE_FIELDS) {
      checks.push([`line ${index + 1} ${field}`, expectedLine ? matches(expectedLine, actualLine) : false]);
    }
  }
  const correct = checks.filter(([, ok]) => ok).length;
  return {
    correct,
    total: checks.length,
    accuracy: checks.length === 0 ? 1 : correct / checks.length,
    lineCountMatches: expected.lines.length === actual.lines.length,
    misses: checks.filter(([, ok]) => !ok).map(([name]) => name),
  };
}
