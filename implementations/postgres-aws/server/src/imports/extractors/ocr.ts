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

// Readies a rendered page for recognition: text on coloured bands made dark
// on white, highlighter faded and table rules erased.
export function prepareScan(context: DrawingContext, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height);
  clearBands(image.data, width, height);
  fadeHighlighter(image.data);
  context.putImageData(image, 0, 0);
  eraseRules(context, width, height);
}

// A band is a run of rows mostly filled with colour, as behind a table's
// headings; thinner runs are rules, taller ones pictures or shading.
const BAND_FILLED = 200;
const BAND_SHARE = 0.5;
const BAND_MIN_HEIGHT = 0.006;
const BAND_MAX_HEIGHT = 0.08;
// Its soft edges, above and below, as a share of its height.
const BAND_EDGE = 0.3;
// Colour distances from the band's colour: nearer is the band, farther text.
const BAND_NEAR = 40;
const BAND_FAR = 120;

// Text on a coloured band, white, outlined or dark, reads poorly, and
// erasing rules would stripe the band, so the band becomes white and
// whatever differs from its colour dark.
export function clearBands(pixels: Uint8ClampedArray, width: number, height: number): void {
  const level = (index: number) => (pixels[index * 4]! + pixels[index * 4 + 1]! + pixels[index * 4 + 2]!) / 3;
  const filledRow = (y: number) => {
    let filled = 0;
    for (let x = 0; x < width; x += 1) {
      if (level(y * width + x) < BAND_FILLED) filled += 1;
    }
    return filled >= width * BAND_SHARE;
  };
  for (let y = 0; y < height; ) {
    if (!filledRow(y)) {
      y += 1;
      continue;
    }
    let end = y;
    while (end < height && filledRow(end)) end += 1;
    const rows = end - y;
    if (rows >= height * BAND_MIN_HEIGHT && rows <= height * BAND_MAX_HEIGHT) {
      clearBand(pixels, width, height, y, end, level);
    }
    y = end;
  }
}

// Columns of a band's text may be mostly unfilled; wider gaps end it.
const BAND_GAP = 0.02;

function clearBand(pixels: Uint8ClampedArray, width: number, height: number, top: number, bottom: number, level: (index: number) => number) {
  // Its extent: the longest run of columns filled in most of its rows, so
  // a scan's coloured edge beside it isn't taken in.
  const rows = bottom - top;
  let left = 0;
  let right = -1;
  let start = -1;
  let last = -1;
  for (let x = 0; x < width; x += 1) {
    let filled = 0;
    for (let y = top; y < bottom; y += 1) {
      if (level(y * width + x) < BAND_FILLED) filled += 1;
    }
    if (filled > rows / 2) {
      if (start < 0 || x - last > width * BAND_GAP) start = x;
      last = x;
      if (last - start > right - left) [left, right] = [start, last];
    }
  }
  const channels: number[][] = [[], [], []];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      if (level(y * width + x) < BAND_FILLED) channels.forEach((values, channel) => values.push(pixels[offset + channel]!));
    }
  }
  const colour = channels.map(median);
  const distance = (offset: number) => Math.hypot(...colour.map((value, channel) => pixels[offset + channel]! - value));
  const edge = Math.ceil(rows * BAND_EDGE);
  for (let y = Math.max(0, top - edge); y < Math.min(height, bottom + edge); y += 1) {
    const inside = y >= top && y < bottom;
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      const far = Math.min(1, Math.max(0, (distance(offset) - BAND_NEAR) / (BAND_FAR - BAND_NEAR)));
      // Graded, not thresholded: scanned text is rarely one colour. Beside
      // the band only its colour goes, the page around it being white.
      if (inside) {
        pixels.fill(Math.round(255 * (1 - far)), offset, offset + 3);
      } else if (far === 0) {
        pixels.fill(255, offset, offset + 3);
      }
    }
  }
}

// Highlighter is bright and strongly coloured; ink, coloured or not, is
// darker, so it stays.
const HIGHLIGHT_BRIGHTEST = 170;
const HIGHLIGHT_COLOUR = 70;
const HIGHLIGHT_LEVEL = 130;

export function fadeHighlighter(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const brightest = Math.max(red, green, blue);
    if (brightest >= HIGHLIGHT_BRIGHTEST && brightest - Math.min(red, green, blue) >= HIGHLIGHT_COLOUR && (red + green + blue) / 3 >= HIGHLIGHT_LEVEL) {
      pixels.fill(255, offset, offset + 3);
    }
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 255;
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
      (context, w, h) => prepareScan(context as DrawingContext, w, h),
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
