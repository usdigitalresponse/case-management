// Scores extraction methods against the synthetic PDF corpus in
// scenarios/fixtures/invoices/, field by field, so methods can be compared
// on accuracy (and, run with timing, speed) before one is chosen.
// npm run extraction-accuracy [-- extractor-id ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRACTORS } from '../src/imports/extractors';
import { scoreExtraction, type ExpectedDocument } from '../src/imports/extractors/scoreExtraction';
import { UnreadableInvoiceFileError } from '../src/imports/parsedInvoice';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');

async function main() {
  const expected = JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as Record<
    string,
    { document?: ExpectedDocument }
  >;
  const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(EXTRACTORS);
  for (const id of ids) {
    const extractor = EXTRACTORS[id];
    if (!extractor) {
      throw new Error(`Unknown extractor ${id}`);
    }
    let correct = 0;
    let total = 0;
    // eslint-disable-next-line no-console
    console.log(`\n${extractor.id} v${extractor.version} (${extractor.inBoundary ? 'in boundary' : 'outside boundary'})`);
    for (const [file, entry] of Object.entries(expected)) {
      if (!entry.document) {
        continue;
      }
      const started = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const result = await extractor.extract(readFileSync(join(SAMPLES_DIR, file))).then(
        (parsed) => scoreExtraction(entry.document!, parsed),
        (error: unknown) => {
          if (!(error instanceof UnreadableInvoiceFileError)) {
            throw error;
          }
          return { correct: 0, total: 4 + entry.document!.lines.length * 7, accuracy: 0, lineCountMatches: false, misses: [error.fieldErrors.file!] };
        },
      );
      correct += result.correct;
      total += result.total;
      const misses = result.misses.length > 0 ? `  misses: ${result.misses.slice(0, 6).join('; ')}${result.misses.length > 6 ? '; …' : ''}` : '';
      // eslint-disable-next-line no-console
      console.log(`  ${file.padEnd(22)} ${(result.accuracy * 100).toFixed(0).padStart(3)}%  ${String(Date.now() - started).padStart(4)} ms${misses}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  overall ${((correct / total) * 100).toFixed(1)}% of ${total} fields`);
  }
}

void main();
