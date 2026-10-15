// Opens PDFs with PDF.js in-process, for reading text and rendering pages.
// No fonts are loaded, and PDF.js's core never runs a document's scripts (only
// its viewer's sandbox does).
import { join } from 'node:path';
import { UnreadableInvoiceFileError } from '../parsedInvoice';

// Upload defaults (docs/invoice-import-export-plan.md "Upload defaults").
const MAX_PAGES = 50;

// PDF.js is ESM-only; this CommonJS server require()s it (Node 22.12+).
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

export interface PdfPage {
  // The page's own rotation in degrees.
  rotate: number;
  getViewport(options: { scale: number; rotation?: number }): { width: number; height: number };
  render(options: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: Array<PdfTextItem | object> }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

export interface CanvasAndContext {
  canvas: { toBuffer(type: 'image/png'): Buffer };
  context: unknown;
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  canvasFactory: {
    create(width: number, height: number): CanvasAndContext;
    destroy(canvasAndContext: CanvasAndContext): void;
  };
}

interface PdfJs {
  OPS: Record<string, number>;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
}

let pdfjs: PdfJs | undefined;
export function loadPdfJs(): PdfJs {
  if (!pdfjs) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs') as PdfJs;
    // Runs in-process ("fake worker"); this only tells PDF.js where it is.
    pdfjs.GlobalWorkerOptions.workerSrc = join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy/build/pdf.worker.mjs');
  }
  return pdfjs;
}

// Opens the PDF, checks its page limit, runs `read` and closes it.
export async function withPdf<T>(bytes: Buffer, read: (document: PdfDocument) => Promise<T>): Promise<T> {
  const task = loadPdfJs().getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    let document: PdfDocument;
    try {
      document = await task.promise;
    } catch {
      throw new UnreadableInvoiceFileError('This PDF could not be opened. It may be damaged or password-protected.');
    }
    if (document.numPages > MAX_PAGES) {
      throw new UnreadableInvoiceFileError(`PDFs can have at most ${MAX_PAGES} pages.`);
    }
    return await read(document);
  } finally {
    await task.destroy();
  }
}

// A page can claim any size; renders stop at about A3 at 300 DPI, so a
// hostile file can't make one allocate gigabytes.
const MAX_RENDER_PIXELS = 25_000_000;

// One page as a PNG at `requestedScale` (1 = 72 DPI), or smaller for a page
// too big to render at that scale; `adjust` can change it before encoding
// (ocr.ts erases table rules). `scale` in the result is the one used.
export async function renderPage(
  document: PdfDocument,
  pageNumber: number,
  requestedScale: number,
  adjust?: (context: unknown, width: number, height: number) => void,
  // Degrees clockwise on top of the page's own rotation.
  turn = 0,
): Promise<{ png: Buffer; width: number; height: number; scale: number }> {
  const page = await document.getPage(pageNumber);
  const rotation = (page.rotate + turn) % 360;
  const natural = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(requestedScale, Math.sqrt(MAX_RENDER_PIXELS / Math.max(natural.width * natural.height, 1)));
  const viewport = page.getViewport({ scale, rotation });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const target = document.canvasFactory.create(width, height);
  try {
    await page.render({ canvasContext: target.context, viewport }).promise;
    adjust?.(target.context, width, height);
    return { png: target.canvas.toBuffer('image/png'), width, height, scale };
  } finally {
    document.canvasFactory.destroy(target);
  }
}
