// Field-by-field accuracy against scenarios/fixtures/invoices/expected.json,
// for comparing extraction methods.
import { cents, lineTotalCents, type ParsedInvoice, type ParsedLine } from '../parsedInvoice';

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

// Figures only, for real invoices kept outside Git whose expected values
// someone transcribed by hand (extraction-accuracy --samples).
export interface ExpectedFigures {
  statedTotal: string;
  lines: Array<{ amount: string; quantity?: number; unitRate?: number; serviceDate?: string }>;
}

export interface FiguresScore {
  expectedLines: number;
  found: number;
  extra: number;
  quantity: number;
  unitRate: number;
  serviceDate: number;
  dated: number;
  statedTotal: boolean;
  sumMatches: boolean;
}

// Lines are paired by amount in order (longest common subsequence), so a
// junk line doesn't shift every later match; other figures are compared
// on paired lines.
export function scoreFigures(expected: ExpectedFigures, actual: ParsedInvoice): FiguresScore {
  const want = expected.lines;
  const got = actual.lines;
  const best = Array.from({ length: want.length + 1 }, () => new Array<number>(got.length + 1).fill(0));
  for (let i = want.length - 1; i >= 0; i -= 1) {
    for (let j = got.length - 1; j >= 0; j -= 1) {
      best[i]![j] = sameNumber(want[i]!.amount, got[j]!.amount) ? best[i + 1]![j + 1]! + 1 : Math.max(best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < want.length && j < got.length; ) {
    if (sameNumber(want[i]!.amount, got[j]!.amount)) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const count = (matches: (e: ExpectedFigures['lines'][number], a: ParsedLine) => boolean) =>
    pairs.filter(([i, j]) => matches(want[i]!, got[j]!)).length;
  const sum = lineTotalCents(got);
  return {
    expectedLines: want.length,
    found: pairs.length,
    extra: got.length - pairs.length,
    quantity: count((e, a) => sameNumber(e.quantity, a.quantity)),
    unitRate: count((e, a) => sameNumber(e.unitRate, a.unitRate)),
    serviceDate: count((e, a) => e.serviceDate !== undefined && e.serviceDate === a.serviceDate),
    dated: want.filter((line) => line.serviceDate !== undefined).length,
    statedTotal: sameNumber(actual.statedTotal, expected.statedTotal),
    sumMatches: got.length > 0 && sum === cents(Number(expected.statedTotal)),
  };
}

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
