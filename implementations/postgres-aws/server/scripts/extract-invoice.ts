// Shows what import would read from invoice files, without a database: for
// trying real product exports locally (kept outside Git).
//
//   npm run extract-invoice -- [--json | --csv] file [more files]
//
// Text (the default) is for reading; --json gives the full parsed result,
// --csv one row per item for a spreadsheet. Output goes to stdout, so it
// can be redirected; PDF.js warnings go to stderr. Exits 2 if any file
// couldn't be read, 1 on bad usage.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extractReport, formatReports, type ReportFormat } from '../src/imports/extractionReport';

const USAGE = 'Usage: npm run extract-invoice -- [--json | --csv] file [more files]';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith('--'));
  const files = args.filter((arg) => !arg.startsWith('--'));
  const unknown = flags.filter((flag) => !['--json', '--csv', '--text'].includes(flag));
  if (files.length === 0 || unknown.length > 0 || flags.length > 1) {
    process.stderr.write(`${unknown.length > 0 ? `Unknown option ${unknown.join(', ')}\n` : ''}${USAGE}\n`);
    return 1;
  }
  const format = (flags[0]?.slice(2) ?? 'text') as ReportFormat;

  const reports = [];
  for (const path of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      reports.push({ file: basename(path), error: `Could not read the file: ${(error as Error).message}` });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    reports.push(await extractReport(basename(path), bytes));
  }
  process.stdout.write(formatReports(reports, format));
  return reports.some((report) => report.error) ? 2 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
