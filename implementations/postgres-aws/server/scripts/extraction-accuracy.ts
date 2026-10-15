// Scores extraction methods against the synthetic PDF corpus in
// scenarios/fixtures/invoices/, field by field, so methods can be compared
// on accuracy (and, run with timing, speed) before one is chosen.
// npm run extraction-accuracy [-- extractor-id ...]
//
// With --samples <dir>, scores real invoices kept outside Git instead, on
// their figures only, against <dir>/expected.json:
// { "file.pdf": { "statedTotal": "100.00", "lines": [{ "amount": "60.00",
//   "quantity": 2, "unitRate": 30, "serviceDate": "2026-01-05" }, ...] } }
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRACTORS } from '../src/imports/extractors';
import { scoreExtraction, scoreFigures, type ExpectedDocument, type ExpectedFigures } from '../src/imports/extractors/scoreExtraction';
import { UnreadableInvoiceFileError, type ParsedInvoice } from '../src/imports/parsedInvoice';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');

async function synthetic(ids: string[]) {
  const expected = JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as Record<
    string,
    { document?: ExpectedDocument }
  >;
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

async function local(dir: string, ids: string[]) {
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Record<string, ExpectedFigures>;
  const pct = (part: number, whole: number) => (whole === 0 ? '  -' : `${((part / whole) * 100).toFixed(0).padStart(3)}%`);
  for (const id of ids) {
    const extractor = EXTRACTORS[id];
    if (!extractor) {
      throw new Error(`Unknown extractor ${id}`);
    }
    const sums = { expectedLines: 0, found: 0, extra: 0, quantity: 0, unitRate: 0, serviceDate: 0, dated: 0, statedTotal: 0, sumMatches: 0, ms: 0 };
    // eslint-disable-next-line no-console
    console.log(`\n${extractor.id} v${extractor.version}: lines found, extra lines, quantity, rate, date, stated total, items add up`);
    for (const [file, want] of Object.entries(expected)) {
      const started = Date.now();
      let parsed: ParsedInvoice = { lines: [] };
      let error = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        parsed = await extractor.extract(readFileSync(join(dir, file)));
      } catch (caught) {
        if (!(caught instanceof UnreadableInvoiceFileError)) {
          throw caught;
        }
        error = `  ${caught.fieldErrors.file}`;
      }
      const ms = Date.now() - started;
      const score = scoreFigures(want, parsed);
      for (const key of ['expectedLines', 'found', 'extra', 'quantity', 'unitRate', 'serviceDate', 'dated'] as const) {
        sums[key] += score[key];
      }
      sums.statedTotal += score.statedTotal ? 1 : 0;
      sums.sumMatches += score.sumMatches ? 1 : 0;
      sums.ms += ms;
      // eslint-disable-next-line no-console
      console.log(
        `  ${file.padEnd(36)} ${String(score.found).padStart(3)}/${String(score.expectedLines).padEnd(3)} +${String(score.extra).padEnd(3)}` +
          ` ${pct(score.quantity, score.expectedLines)} ${pct(score.unitRate, score.expectedLines)} ${pct(score.serviceDate, score.dated)}` +
          `  ${score.statedTotal ? 'yes' : 'no '} ${score.sumMatches ? 'yes' : 'no '} ${String(ms).padStart(6)} ms${error}`,
      );
    }
    const files = Object.keys(expected).length;
    // eslint-disable-next-line no-console
    console.log(
      `  overall: ${pct(sums.found, sums.expectedLines)} of ${sums.expectedLines} lines found, ${sums.extra} extra;` +
        ` quantity ${pct(sums.quantity, sums.expectedLines)}, rate ${pct(sums.unitRate, sums.expectedLines)}, date ${pct(sums.serviceDate, sums.dated)};` +
        ` stated total ${sums.statedTotal}/${files}, items add up ${sums.sumMatches}/${files}; ${(sums.ms / 1000).toFixed(0)} s`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const samplesAt = args.indexOf('--samples');
  const dir = samplesAt >= 0 ? args[samplesAt + 1] : undefined;
  if (samplesAt >= 0 && !dir) {
    throw new Error('--samples needs a directory');
  }
  const named = args.filter((arg, index) => !arg.startsWith('--') && (samplesAt < 0 || index !== samplesAt + 1));
  const ids = named.length > 0 ? named : Object.keys(EXTRACTORS);
  await (dir ? local(dir, ids) : synthetic(ids));
}

void main();
