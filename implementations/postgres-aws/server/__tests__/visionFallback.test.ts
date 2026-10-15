// The vision-model follow-up pass and background extraction queue, with the
// model's HTTP API stubbed: tests never call a real model.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconciles, withVisionFallback } from '../src/imports/extractors';
import { extractWithVision, RECIPE, visionConfig } from '../src/imports/extractors/vision';
import type { InvoiceExtractor } from '../src/imports/extractors/types';
import { reconciliationWarnings, UnreadableInvoiceFileError, type ParsedInvoice } from '../src/imports/parsedInvoice';
import { cancelExtraction, enqueueExtraction, extractionProgress, extractionsSettled } from '../src/imports/extractionJobs';

const config = { url: 'http://vision.test', model: 'test-vl:7b' };
const line = (amount: number) => ({ location: 'x', lineType: 'time' as const, amount });

function primary(result: ParsedInvoice | Error): InvoiceExtractor {
  return {
    id: 'pdf-text-layer',
    version: '2',
    inBoundary: true,
    extract: async () => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
}

const visionResult: ParsedInvoice = { statedTotal: 30, lines: [line(10), line(20)], extractionMethod: 'pdf-vision test 1' };

describe('vision fallback', () => {
  it('reads with the model only when the first reading fails or does not add up', async () => {
    const read = vi.fn(async () => visionResult);
    const good: ParsedInvoice = { statedTotal: 30, lines: [line(30)] };
    expect(await withVisionFallback(primary(good), config, read).extract(Buffer.alloc(0))).toBe(good);
    expect(read).not.toHaveBeenCalled();

    const unreadable = new UnreadableInvoiceFileError('No table of invoice items was found in this PDF.');
    expect(await withVisionFallback(primary(unreadable), config, read).extract(Buffer.alloc(0))).toBe(visionResult);

    const offBy = { statedTotal: 30, lines: [line(25)] };
    expect(await withVisionFallback(primary(offBy), config, read).extract(Buffer.alloc(0))).toBe(visionResult);
  });

  it('keeps whichever reading is nearer the stated total when neither adds up, and the first without a model', async () => {
    const offBy: ParsedInvoice = { statedTotal: 30, lines: [line(25)] };
    const furtherOff = vi.fn(async () => ({ ...visionResult, lines: [line(5)] }));
    const kept = await withVisionFallback(primary(offBy), config, furtherOff).extract(Buffer.alloc(0));
    expect(kept.lines).toEqual(offBy.lines);
    expect(kept.warnings?.map((warning) => warning.code)).toEqual(['readings_did_not_reconcile']);

    const nearer = vi.fn(async () => ({ ...visionResult, statedTotal: 0, lines: [line(29)] }));
    const replaced = await withVisionFallback(primary(offBy), config, nearer).extract(Buffer.alloc(0));
    expect(replaced.lines).toEqual([line(29)]);
    expect(replaced.extractionMethod).toBe('pdf-vision test 1');

    const down = vi.fn(async () => {
      throw new Error('connection refused');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await withVisionFallback(primary(offBy), config, down).extract(Buffer.alloc(0))).toBe(offBy);
    const unreadable = new UnreadableInvoiceFileError('No text could be read from this PDF.');
    await expect(withVisionFallback(primary(unreadable), config, down).extract(Buffer.alloc(0))).rejects.toBe(unreadable);

    const plain = primary(offBy);
    expect(withVisionFallback(plain, undefined)).toBe(plain);
  });

  // Text in a document can talk a model into items and a total that agree
  // with each other; the total read from the document's own text can't be.
  it('holds a model reading to the total in the document’s own text', async () => {
    const injected = vi.fn(async () => ({ ...visionResult, statedTotal: 9999, lines: [line(9999)] }));
    const refused = new UnreadableInvoiceFileError('No table of invoice items was found in this PDF.', { statedTotal: 30 });
    const flagged = await withVisionFallback(primary(refused), config, injected).extract(Buffer.alloc(0));
    expect(flagged.lines).toEqual([line(9999)]);
    expect(flagged.warnings?.map((warning) => warning.code)).toEqual(['totals_disagree']);

    const offBy: ParsedInvoice = { statedTotal: 30, lines: [line(25)] };
    const kept = await withVisionFallback(primary(offBy), config, injected).extract(Buffer.alloc(0));
    expect(kept.lines).toEqual(offBy.lines);
    expect(kept.warnings?.map((warning) => warning.code)).toEqual(['readings_did_not_reconcile']);
  });

  it('checks a model reading without a total against the document’s', async () => {
    const noTotal = vi.fn(async () => ({ ...visionResult, statedTotal: undefined, lines: [line(999)] }));
    const offBy: ParsedInvoice = { statedTotal: 30, lines: [line(25)] };
    const kept = await withVisionFallback(primary(offBy), config, noTotal).extract(Buffer.alloc(0));
    expect(kept.lines).toEqual(offBy.lines);

    const refused = new UnreadableInvoiceFileError('No table of invoice items was found in this PDF.', { statedTotal: 30 });
    const only = await withVisionFallback(primary(refused), config, noTotal).extract(Buffer.alloc(0));
    // The document's total is filled in, so the usual check flags the items.
    expect(only.statedTotal).toBe(30);
    expect(reconciliationWarnings(only).map((warning) => warning.code)).toContain('stated_total_mismatch');
  });

  // Text recognition can misread the total itself, as on a scanned letter
  // whose receipt attachment it took for the invoice.
  it('accepts a model reading that adds up over a misread recognized total, flagged', async () => {
    const misread: ParsedInvoice = { statedTotal: 7, lines: [line(48), line(45)], warnings: [{ code: 'read_by_ocr', message: '' }] };
    const correct = vi.fn(async () => ({ ...visionResult, statedTotal: 12711, lines: [line(12000), line(711)] }));
    const parsed = await withVisionFallback(primary(misread), config, correct).extract(Buffer.alloc(0));
    expect(parsed.lines).toEqual([line(12000), line(711)]);
    expect(parsed.warnings?.map((warning) => warning.code)).toContain('totals_disagree');

    const refused = new UnreadableInvoiceFileError('No table of invoice items was found in this PDF.', { statedTotal: 7, recognized: true });
    expect((await withVisionFallback(primary(refused), config, correct).extract(Buffer.alloc(0))).statedTotal).toBe(12711);
  });

  it('checks subtotals, and treats an unchecked recognized scan as not adding up', () => {
    expect(reconciles({ lines: [line(5)] })).toBe(true);
    expect(reconciles({ lines: [line(5)], warnings: [{ code: 'read_by_ocr', message: '' }] })).toBe(false);
    expect(reconciles({ statedTotal: 5, lines: [line(5)], warnings: [{ code: 'subtotal_mismatch', message: '' }] })).toBe(false);
  });

  it('is configured by INVOICE_VISION_URL and INVOICE_VISION_MODEL together', () => {
    expect(visionConfig({})).toBeUndefined();
    expect(visionConfig({ INVOICE_VISION_URL: 'http://x:11434/' })).toBeUndefined();
    expect(visionConfig({ INVOICE_VISION_URL: 'http://x:11434/', INVOICE_VISION_MODEL: 'm' })).toEqual({ url: 'http://x:11434', model: 'm' });
  });
});

describe('vision extractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads items from the model, skipping attachment pages, and records the model build', async () => {
    const answers = [
      {
        is_invoice_items_page: true,
        invoice_number: 'SAMPLE-1',
        items: [
          { date: '2026-05-04', description: 'Record review', quantity: 6, rate: 300, amount: 1800 },
          { date: null, description: 'Mileage to court', quantity: 42, rate: 0.7, amount: 29.4 },
        ],
        invoice_total: 1829.4,
      },
    ];
    // An attachment page's total never replaces the invoice's.
    const attachment = { is_invoice_items_page: false, invoice_number: null, items: [], invoice_total: 0 };
    const requests: Array<{ images?: string[]; format?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (url.endsWith('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'test-vl:7b', digest: '5ced39dfa4ba0123' }] }));
        }
        requests.push(JSON.parse(init?.body ?? '{}'));
        return new Response(JSON.stringify({ response: JSON.stringify(answers.shift() ?? attachment) }));
      }),
    );
    const progress: unknown[] = [];
    const bytes = readFileSync(join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices', 'pdf-unlabelled.pdf'));
    const parsed = await extractWithVision(config, bytes, { onProgress: (p) => progress.push(p) });

    expect(parsed.extractionMethod).toBe(`pdf-vision test-vl:7b@5ced39dfa4ba recipe ${RECIPE}`);
    expect(RECIPE).toMatch(/^[0-9a-f]{8}$/);
    expect(parsed).toMatchObject({ invoiceNumber: 'SAMPLE-1', statedTotal: 1829.4 });
    expect(parsed.lines).toMatchObject([
      { lineType: 'time', serviceDate: '2026-05-04', quantity: 6, unitRate: 300, amount: 1800 },
      { lineType: 'expense', serviceDate: undefined, quantity: 42, unitRate: 0.7, amount: 29.4 },
    ]);
    expect(parsed.warnings?.map((warning) => warning.code)).toEqual(['read_by_model']);
    expect(progress).toEqual([{ stage: 'model', page: 1, pages: 1 }]);
    expect(requests[0]?.images).toHaveLength(1);
    expect(requests[0]?.format).toMatchObject({ type: 'object' });
  });
});

describe('background extraction queue', () => {
  it('runs one job at a time and reports where each has got to', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = enqueueExtraction('import-1', async (onProgress) => {
      onProgress({ stage: 'recognizing', page: 2, pages: 5 });
      await firstBlocked;
    });
    const second = enqueueExtraction('import-2', async () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(extractionProgress('import-1')).toEqual({ stage: 'recognizing', page: 2, pages: 5 });
    expect(extractionProgress('import-2')).toEqual({ stage: 'queued', ahead: 1 });
    releaseFirst();
    await Promise.all([first, second]);
    await extractionsSettled();
    expect(extractionProgress('import-1')).toBeUndefined();
    expect(extractionProgress('import-2')).toBeUndefined();
  });

  it('drops a cancelled job that is waiting, and tells a running one to stop', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSignal: AbortSignal | undefined;
    const first = enqueueExtraction('import-5', async (_onProgress, signal) => {
      firstSignal = signal;
      await firstBlocked;
    });
    const waitingWork = vi.fn(async () => undefined);
    const second = enqueueExtraction('import-6', waitingWork);
    await Promise.resolve();
    await Promise.resolve();

    cancelExtraction('import-6');
    expect(extractionProgress('import-6')).toBeUndefined();
    cancelExtraction('import-5');
    expect(firstSignal?.aborted).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(waitingWork).not.toHaveBeenCalled();
  });

  it('keeps going after a failed job', async () => {
    const failed = enqueueExtraction('import-3', async () => {
      throw new Error('boom');
    });
    const next = enqueueExtraction('import-4', async () => undefined);
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBeUndefined();
  });
});
