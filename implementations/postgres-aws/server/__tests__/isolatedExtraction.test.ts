// Documents read in a child process with memory and time limits. The child
// loads the TypeScript sources through tsx, as the development server does.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { ExtractionCancelledError, isolationEnabled, memoryLimitMb, parseIsolated } from '../src/imports/isolatedExtraction';
import { UnreadableInvoiceFileError } from '../src/imports/parsedInvoice';
import type { ExtractionProgress } from '../src/imports/extractors/types';

const tsx = dirname(require.resolve('tsx/package.json'));
const execArgv = ['--require', join(tsx, 'dist', 'preflight.cjs'), '--import', pathToFileURL(join(tsx, 'dist', 'loader.mjs')).href];
const sample = (file: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices', file));

function notAnInvoicePdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.text('Meeting notes: nothing to bill this month.');
  doc.end();
  return done;
}

describe('isolated extraction', () => {
  it('is on unless set to inline', () => {
    expect(isolationEnabled({})).toBe(true);
    expect(isolationEnabled({ INVOICE_EXTRACTION_ISOLATION: 'inline' })).toBe(false);
  });

  it('takes the reader’s heap limit from INVOICE_EXTRACTION_MEMORY_MB, ignoring nonsense', () => {
    expect(memoryLimitMb({})).toBe(512);
    expect(memoryLimitMb({ INVOICE_EXTRACTION_MEMORY_MB: '256' })).toBe(256);
    expect(memoryLimitMb({ INVOICE_EXTRACTION_MEMORY_MB: 'lots' })).toBe(512);
    expect(memoryLimitMb({ INVOICE_EXTRACTION_MEMORY_MB: '-1' })).toBe(512);
  });

  it('reads a document in a child process, passing progress back', async () => {
    const progress: ExtractionProgress[] = [];
    const parsed = await parseIsolated(sample('pdf-scanned-unlabelled.pdf'), (p) => progress.push(p), { execArgv });
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.warnings?.map((warning) => warning.code)).toContain('read_by_ocr');
    expect(progress).toContainEqual({ stage: 'recognizing', page: 1, pages: 1 });
  }, 60_000);

  it('passes back why a document can’t be read', async () => {
    const failure = await parseIsolated(await notAnInvoicePdf(), () => undefined, { execArgv }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnreadableInvoiceFileError);
    expect((failure as UnreadableInvoiceFileError).fieldErrors.file).toMatch(/No table of invoice items/);
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
