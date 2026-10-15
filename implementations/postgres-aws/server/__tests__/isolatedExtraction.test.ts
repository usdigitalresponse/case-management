// Documents read in a child process with memory and time limits. The child
// loads the TypeScript sources through tsx, as the development server does.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExtractionCancelledError, isolationEnabled, parseIsolated } from '../src/imports/isolatedExtraction';
import { UnreadableInvoiceFileError } from '../src/imports/parsedInvoice';
import type { ExtractionProgress } from '../src/imports/extractors/types';

const tsx = dirname(require.resolve('tsx/package.json'));
const execArgv = ['--require', join(tsx, 'dist', 'preflight.cjs'), '--import', pathToFileURL(join(tsx, 'dist', 'loader.mjs')).href];
const sample = (file: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices', file));

describe('isolated extraction', () => {
  it('is on unless set to inline', () => {
    expect(isolationEnabled({})).toBe(true);
    expect(isolationEnabled({ INVOICE_EXTRACTION_ISOLATION: 'inline' })).toBe(false);
  });

  it('reads a document in a child process, passing progress back', async () => {
    const progress: ExtractionProgress[] = [];
    const parsed = await parseIsolated(sample('pdf-scanned-unlabelled.pdf'), (p) => progress.push(p), { execArgv });
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.warnings?.map((warning) => warning.code)).toContain('read_by_ocr');
    expect(progress).toContainEqual({ stage: 'recognizing', page: 1, pages: 1 });
  }, 60_000);

  it('passes back why a document can’t be read, with what was found', async () => {
    const failure = await parseIsolated(sample('pdf-letter.pdf'), () => undefined, { execArgv }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnreadableInvoiceFileError);
    expect((failure as UnreadableInvoiceFileError).found.statedTotal).toBe(6211);
  }, 60_000);

  it('stops a read whose import is discarded', async () => {
    const controller = new AbortController();
    const reading = parseIsolated(sample('pdf-scanned-continued.pdf'), () => controller.abort(), { execArgv, signal: controller.signal });
    await expect(reading).rejects.toThrow(ExtractionCancelledError);
  }, 60_000);

  it('stops a read that runs out of time', async () => {
    await expect(parseIsolated(sample('pdf-scanned-continued.pdf'), () => undefined, { execArgv, timeMs: 300 })).rejects.toThrow(
      UnreadableInvoiceFileError,
    );
  }, 60_000);
});
