// Every shared synthetic invoice in scenarios/fixtures/invoices/ must parse
// (or fail) exactly as its expected.json entry says, so a parser change that
// breaks a sample fails here. PDFs are scored field by field against their
// expected values. No database needed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectInvoiceFile } from '../src/imports/detectFormat';
import { reconciliationWarnings } from '../src/imports/parsedInvoice';
import { scoreExtraction, type ExpectedDocument } from '../src/imports/extractors/scoreExtraction';
import type { ParsedInvoice } from '../src/imports/parsedInvoice';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');

// The in-app text-layer extractor's measured accuracy on each PDF (npm run
// extraction-accuracy). Raise these as it improves; a drop is a regression.
// The voucher's counsel name sits outside its table, so timekeepers miss.
const TEXT_LAYER_BASELINE: Record<string, number> = {
  'pdf-itemized.pdf': 1,
  'pdf-coded.pdf': 1,
  'pdf-summary.pdf': 1,
  'pdf-voucher.pdf': 0.88,
  'pdf-multipage.pdf': 1,
  'pdf-sectioned.pdf': 1,
  'pdf-stacked.pdf': 1,
};

interface Expected {
  format: string;
  invoiceNumber?: string;
  lineTypes?: string[];
  total?: string;
  warnings?: string[];
  unreadable?: string;
  sameLinesAs?: string;
  document?: ExpectedDocument;
}

const expected = JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as Record<string, Expected>;

async function parse(fileName: string): Promise<ParsedInvoice> {
  return detectInvoiceFile(readFileSync(join(SAMPLES_DIR, fileName))).parse();
}

describe('shared synthetic invoice samples', () => {
  it('lists an expected result for every sample file', () => {
    const samples = readdirSync(SAMPLES_DIR).filter((name) => !['expected.json', 'README.md'].includes(name));
    expect(samples.sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [fileName, want] of Object.entries(expected)) {
    it(fileName, async () => {
      expect(detectInvoiceFile(readFileSync(join(SAMPLES_DIR, fileName))).format).toBe(want.format);

      if (want.unreadable) {
        await expect(parse(fileName)).rejects.toMatchObject({
          fieldErrors: { file: expect.stringContaining(want.unreadable) },
        });
        return;
      }

      const parsed = await parse(fileName);
      if (want.document) {
        const score = scoreExtraction(want.document, parsed);
        expect(score.accuracy, score.misses.join('; ')).toBeGreaterThanOrEqual(TEXT_LAYER_BASELINE[fileName] ?? 1);
        expect(score.lineCountMatches).toBe(true);
        return;
      }
      if (want.sameLinesAs) {
        expect(parsed).toEqual(await parse(want.sameLinesAs));
        return;
      }
      expect(parsed.invoiceNumber).toBe(want.invoiceNumber);
      expect(parsed.lines.map((line) => line.lineType)).toEqual(want.lineTypes);
      const totalCents = parsed.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
      expect((totalCents / 100).toFixed(2)).toBe(want.total);
      expect(reconciliationWarnings(parsed).map((warning) => warning.code)).toEqual(want.warnings);
    });
  }
});
