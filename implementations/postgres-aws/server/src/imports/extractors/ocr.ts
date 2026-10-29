// Text recognition for PDFs with no usable text layer (scans, including
// searchable ones): PDF.js renders each page and tesseract.js reads it with
// bundled English data, so nothing is downloaded or sent anywhere.
import { dirname, join } from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import { UnreadableInvoiceFileError } from '../parsedInvoice';
import { renderPage, type PdfDocument } from './pdfDocument';

// 300 DPI: smaller print on scanned invoices is misread at lower resolutions.
const RENDER_SCALE = 300 / 72;

export interface OcrWord {
  text: string;
  // PDF points, origin bottom-left like PDF.js text items; y is the baseline.
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  // Words Tesseract placed on the same text line share it.
  line: number;
}

// Table rules wreck recognition of the text between them, so dark runs
// longer than any letter stroke are erased first. A run is traced through
// the row (or column) and its neighbours so slightly turned scans count.
const RULE_LENGTH = 100;
const DARK = 128;
// A rule's anti-aliased edges are lighter; within an erased band they go too.
const INK = 220;
const BAND = 2;

interface ImageData {
  data: Uint8ClampedArray;
}
interface DrawingContext {
  getImageData(x: number, y: number, width: number, height: number): ImageData;
  putImageData(image: ImageData, x: number, y: number): void;
}

export function eraseRules(context: DrawingContext, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const dark = new Uint8Array(width * height);
  const ink = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const level = (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) / 3;
    dark[index] = level < DARK ? 1 : 0;
    ink[index] = level < INK ? 1 : 0;
  }
  const erase = new Uint8Array(width * height);
  // Along x for horizontal rules, then along y for vertical ones.
  for (const horizontal of [true, false]) {
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const at = (line: number, position: number) => (horizontal ? line * width + position : position * width + line);
    for (let line = 1; line < lines - 1; line += 1) {
      let start = -1;
      for (let position = 0; position <= length; position += 1) {
        const isDark =
          position < length && (dark[at(line - 1, position)] || dark[at(line, position)] || dark[at(line + 1, position)]);
        if (isDark && start < 0) {
          start = position;
        } else if (!isDark && start >= 0) {
          if (position - start >= RULE_LENGTH) {
            for (let p = start; p < position; p += 1) {
              for (let near = Math.max(0, line - BAND); near <= Math.min(lines - 1, line + BAND); near += 1) {
                erase[at(near, p)] = 1;
              }
            }
          }
          start = -1;
        }
      }
    }
  }
  for (let index = 0; index < width * height; index += 1) {
    if (erase[index] && ink[index]) {
      pixels.fill(255, index * 4, index * 4 + 3);
    }
  }
  context.putImageData(image, 0, 0);
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// A page taking longer than this is given up on.
const PAGE_TIMEOUT_MS = 60_000;

// A page read upright mostly yields confident words; turned sideways or
// upside down it yields fragments, so it is tried at the other angles too.
const MISREAD_CONFIDENCE = 65;
const MIN_WORDS_TO_JUDGE = 5;
const OTHER_TURNS = [180, 90, 270];

interface PageReading {
  frame: RecognizedFrame;
  words: Omit<OcrWord, 'line'>[];
  // Tesseract's line of each word, numbered within this reading.
  lines: number[];
}

const meanConfidence = (reading: PageReading) =>
  reading.words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(reading.words.length, 1);
// Confident words of two or more letters or digits: how much was really read.
const quality = (reading: PageReading) =>
  reading.words.filter((word) => word.confidence >= MISREAD_CONFIDENCE && /[A-Za-z0-9]{2}/.test(word.text)).length;

async function withTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UnreadableInvoiceFileError(message)), PAGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// `onPage` is told before each page is recognized (1-based, of all pages).
// The frame a page's words are in: turned this many degrees clockwise from
// the page as shown, and its size in points.
export interface RecognizedFrame {
  turn: number;
  width: number;
  height: number;
}

export async function recognizePages(
  document: PdfDocument,
  pageNumbers: number[],
  onPage?: (index: number, count: number) => void,
): Promise<{ words: Map<number, OcrWord[]>; frames: Map<number, RecognizedFrame> }> {
  const worker = await createWorker('eng', undefined, {
    langPath: join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'),
    gzip: true,
    cacheMethod: 'none',
  });
  // One block keeps each table row on one recognized line; on the scanned
  // samples it beat automatic and sparse-text segmentation.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });

  // Coordinates are in the turned page's own frame, which is all the table
  // reader needs.
  async function read(pageNumber: number, turn: number): Promise<PageReading> {
    const { png, width, height, scale } = await renderPage(
      document,
      pageNumber,
      RENDER_SCALE,
      (context, w, h) => eraseRules(context as DrawingContext, w, h),
      turn,
    );
    const { data } = await withTimeout(
      worker.recognize(png, {}, { blocks: true }),
      `Page ${pageNumber} took too long to read. Enter the items by hand instead.`,
    );
    const pageHeight = height / scale;
    const reading: PageReading = { frame: { turn, width: width / scale, height: pageHeight }, words: [], lines: [] };
    let line = 0;
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const textLine of paragraph.lines) {
          line += 1;
          for (const word of textLine.words as TesseractWord[]) {
            const text = word.text.trim();
            if (text === '') {
              continue;
            }
            reading.words.push({
              text,
              x: word.bbox.x0 / scale,
              y: pageHeight - word.bbox.y1 / scale,
              width: (word.bbox.x1 - word.bbox.x0) / scale,
              height: (word.bbox.y1 - word.bbox.y0) / scale,
              confidence: word.confidence,
            });
            reading.lines.push(line);
          }
        }
      }
    }
    return reading;
  }

  const pages = new Map<number, OcrWord[]>();
  const frames = new Map<number, RecognizedFrame>();
  let lineOffset = 0;
  try {
    for (const [index, pageNumber] of pageNumbers.entries()) {
      onPage?.(index + 1, pageNumbers.length);
      // eslint-disable-next-line no-await-in-loop
      let best = await read(pageNumber, 0);
      if (best.words.length >= MIN_WORDS_TO_JUDGE && meanConfidence(best) < MISREAD_CONFIDENCE) {
        for (const turn of OTHER_TURNS) {
          // eslint-disable-next-line no-await-in-loop
          const turned = await read(pageNumber, turn);
          if (quality(turned) > quality(best)) {
            best = turned;
          }
          if (meanConfidence(best) >= MISREAD_CONFIDENCE) {
            break;
          }
        }
      }
      pages.set(
        pageNumber,
        best.words.map((word, at) => ({ ...word, line: lineOffset + best.lines[at]! })),
      );
      frames.set(pageNumber, best.frame);
      lineOffset += Math.max(0, ...best.lines);
    }
  } finally {
    await worker.terminate();
  }
  return { words: pages, frames };
}
