// Records a vision model's answer for every page of synthetic sample PDFs,
// so tests can replay real model output without running a model
// (__tests__/visionReplay.test.ts). Rerun after changing the model, prompt
// or samples, then update the baselines in that test:
//   INVOICE_VISION_URL=… INVOICE_VISION_MODEL=… npm run record-vision-answers [-- file.pdf …]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWithVision, ollamaClient, RECIPE, visionConfig, type PageAnswer } from '../src/imports/extractors/vision';
import { UnreadableInvoiceFileError } from '../src/imports/parsedInvoice';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');
const ANSWERS_DIR = join(__dirname, '..', '__tests__', 'visionAnswers');
// The files the in-app reader refuses or misreads, and one it must keep
// the model away from.
const DEFAULT_FILES = [
  'pdf-letter.pdf',
  'pdf-letter-injected.pdf',
  'pdf-scanned-marked.pdf',
  'pdf-scanned-attachments.pdf',
];

export interface RecordedAnswers {
  model: string;
  digest: string;
  // The prompt, schema and settings the answers came from (vision.ts RECIPE).
  recipe: string;
  // One per page; null where the answer wasn't valid JSON.
  pages: Array<PageAnswer | null>;
}

async function main() {
  const config = visionConfig();
  if (!config) {
    throw new Error('Set INVOICE_VISION_URL and INVOICE_VISION_MODEL first.');
  }
  const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FILES;
  mkdirSync(ANSWERS_DIR, { recursive: true });
  const live = ollamaClient(config);
  for (const file of files) {
    const recording: RecordedAnswers = { model: config.model, digest: await live.digest(), recipe: RECIPE, pages: [] };
    const started = Date.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      await extractWithVision(config, readFileSync(join(SAMPLES_DIR, file)), {}, {
        digest: live.digest,
        async ask(image, page, pages) {
          try {
            const answer = await live.ask(image, page, pages);
            recording.pages[page - 1] = answer;
            return answer;
          } catch (error) {
            if (error instanceof SyntaxError) {
              recording.pages[page - 1] = null;
            }
            throw error;
          }
        },
      });
    } catch (error) {
      // A file with no items is a result worth recording too.
      if (!(error instanceof UnreadableInvoiceFileError)) {
        throw error;
      }
    }
    writeFileSync(join(ANSWERS_DIR, file.replace(/\.pdf$/, '.json')), `${JSON.stringify(recording, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`${file}: ${recording.pages.length} pages in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

void main();
