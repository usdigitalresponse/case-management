// Writes time logs, as an external case management system exports one case's
// time, for cross-checking the demo seed's invoices on the review page. Each
// log is checked against the seeded lines it targets, so a changed seed fails
// here rather than producing logs that no longer test what they say.
// Read-only against the database; the files go to ../demo-invoices/time-logs/
// (gitignored), since they name the seed's Faker people.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import writeXlsxFile from 'write-excel-file/node';
import { db, pool } from '../src/db/client';
import { invoice, invoiceLine, invoiceLineTypes, professional } from '../src/db/schema';
import { csvCell } from '../src/imports/template';

const OUT_DIR = join(__dirname, '..', '..', 'demo-invoices', 'time-logs');

// The other system's export columns, in its order.
const COLUMNS = ['ID (with Link)', 'Date of Service', 'Stop Time', 'Start Time', 'Time Spent', 'Activity Type', 'Caseworker', 'Activity Details'];

interface LogRow {
  date: string;
  hours: number;
  worker: string;
  details?: string;
  start?: string;
  stop?: string;
  type?: 'Attorney' | 'Staff';
}

interface Target {
  caseNumber: string;
  periodStart: string;
  // Time lines the log is written against, as date and hours.
  billed: Array<[string, number]>;
}

interface TestCase {
  file: string;
  title: string;
  target: Target;
  rows: (name: string) => LogRow[];
  // What the review page should show, by line and for the log as a whole.
  expected: (name: string) => string[];
}

// Placeholder accounts, as the other system logs time not tied to a person.
const OFFICE_ACCOUNT = 'Notice_Desk Defense_Office';
const CONTRACT_ACCOUNT = 'Contract Attorney';

const nameVariants = (name: string) => {
  const words = name.split(/\s+/);
  const last = words.at(-1) ?? name;
  return { initial: `${words[0]} ${last[0]}.`, lastFirst: `${last}, ${words.slice(0, -1).join(' ')}` };
};

const EXPERT_MARCH: Target = { caseNumber: '26-CR-00245', periodStart: '2026-03-01', billed: [['2026-03-03', 2], ['2026-03-10', 3.5], ['2026-03-12', 1]] };
const BLOCKING = "With the time log setting on, approving a flagged line's billed hours asks why; with it off, it doesn't, and the flag stays on the line.";

const CASES: TestCase[] = [
  {
    file: '1-expert-26-CR-00245-all-match.xlsx',
    title: "Every line matches (the expert's March invoice, assigned to the demo sign-in)",
    target: EXPERT_MARCH,
    rows: (name) => [
      { date: '2026-03-12', hours: 1, worker: name, details: 'Call with counsel' },
      { date: '2026-03-10', hours: 3.5, worker: name, start: '9:00 AM', stop: '12:30 PM', details: 'Drafted report' },
      { date: '2026-03-03', hours: 2, worker: name },
      { date: '2026-02-20', hours: 1.5, worker: name, details: 'Initial file review' },
      { date: '2025-11-04', hours: 0.5, worker: name },
    ],
    expected: () => [
      'Lines 1-3: match a log entry on date, person and hours.',
      '2 log entries outside the billing period are left out and listed as such.',
      'Line 2: start and stop agree with the hours.',
      'No flags; nothing blocks approval.',
    ],
  },
  {
    file: '2-expert-26-CR-00245-mismatches.xlsx',
    title: 'Hours differ, a line missing from the log, and unbilled time (same invoice)',
    target: EXPERT_MARCH,
    rows: (name) => [
      { date: '2026-03-20', hours: 1.25, worker: name, details: 'Prepared to testify' },
      { date: '2026-03-10', hours: 3, worker: name, start: '9:00 AM', stop: '12:30 PM' },
      { date: '2026-03-03', hours: 2, worker: nameVariants(name).initial },
    ],
    expected: (name) => [
      `Before matching: "${nameVariants(name).initial}" is suggested as ${name} and confirmed once; never merged without asking.`,
      'Line 1: matches once the name is confirmed.',
      'Line 2: flagged, log 3 h, billed 3.5 h. The log entry\'s start and stop (3.5 h) disagree with its own hours, also flagged.',
      'Line 3: flagged, not in the log.',
      'In the log but not billed: 2026-03-20, 1.25 h (information only).',
      BLOCKING,
    ],
  },
  {
    file: '3-investigator-26-CR-0211-split-and-office.xlsx',
    title: "Split entries and an office account (the investigator's February invoice, typed case number a close match)",
    target: { caseNumber: '26-CR-0211', periodStart: '2026-02-01', billed: [['2026-02-04', 0.5], ['2026-02-08', 1.5], ['2026-02-14', 1], ['2026-02-14', 5.5]] },
    rows: (name) => [
      { date: '2026-02-14', hours: 2.5, worker: name, type: 'Staff', details: 'Editing' },
      { date: '2026-02-14', hours: 3, worker: name, type: 'Staff', details: 'Filming' },
      { date: '2026-02-14', hours: 1, worker: name, type: 'Staff' },
      { date: '2026-02-08', hours: 1.5, worker: OFFICE_ACCOUNT, type: 'Staff', details: 'Research' },
      { date: '2026-02-04', hours: 0.5, worker: nameVariants(name).lastFirst, type: 'Staff' },
    ],
    expected: (name) => [
      `"${nameVariants(name).lastFirst}" is suggested as ${name}; "${OFFICE_ACCOUNT}" is marked not a person.`,
      'Line 1: matches.',
      'Line 2: flagged, the only entry that day is under an office account; the reviewer can link it by hand.',
      'Line 3: matches the 1 h entry.',
      'Line 4: flagged, no single entry; 3 h + 2.5 h the same day add up to it. Daily totals agree (6.5 h).',
      BLOCKING,
    ],
  },
  {
    file: '4-partner-26-CR-00211-two-invoices.xlsx',
    title: "One case's log across two invoices (the demo partner's February trips and August invoice)",
    target: { caseNumber: '26-CR-00211', periodStart: '2026-08-01', billed: [['2026-08-03', 1.5], ['2026-08-08', 1.5], ['2026-08-15', 3.25]] },
    rows: (name) => [
      { date: '2026-08-22', hours: 0.75, worker: name, details: 'Hearing prep' },
      { date: '2026-08-15', hours: 0.5, worker: CONTRACT_ACCOUNT },
      { date: '2026-08-14', hours: 3.25, worker: name, details: 'Motion' },
      { date: '2026-08-08', hours: 2, worker: name, start: '10:00 AM', stop: '12:00 PM', details: 'Client meeting' },
      { date: '2026-08-03', hours: 1.5, worker: name },
      { date: '2026-02-10', hours: 1, worker: name, details: 'Client visit' },
      { date: '2026-02-03', hours: 0.5, worker: name, details: 'Travel' },
    ],
    expected: () => [
      'On the August invoice (sent, waiting for a reviewer):',
      'Line 1: matches.',
      'Line 2: flagged, log 2 h, billed 1.5 h (billed less than logged).',
      'Line 3: flagged, same hours logged the day before; the reviewer can link it by hand.',
      'Filing fee: not checked; the log holds time only.',
      'In the log but not billed: 2026-08-22, 0.75 h (the line the partner removed before sending) and a contract attorney account\'s 0.5 h.',
      'February entries are left out as outside the period.',
      'On the February trips invoice (same case number, same file): the 0.5 h travel time matches; mileage and parking are not checked; 2026-02-10, 1 h, is in the log but not billed.',
      BLOCKING,
    ],
  },
  {
    file: '5-partner-26-CR-00261-entering.csv',
    title: 'CSV with its columns reordered, while the demo sign-in is entering the invoice',
    target: { caseNumber: '26-CR-00261', periodStart: '2026-10-01', billed: [['2026-10-03', 1.5], ['2026-10-08', 2], ['2026-10-15', 3.25], ['2026-10-22', 0.75]] },
    rows: (name) => [
      { date: '2026-10-22', hours: 0.75, worker: name },
      { date: '2026-10-15', hours: 3.25, worker: name, start: '1:00 PM', stop: '4:15 PM' },
      { date: '2026-10-08', hours: 2, worker: name },
      { date: '2026-10-03', hours: 1.5, worker: name, details: 'Discovery review' },
      { date: '2026-10-03', hours: 1.5, worker: name, details: 'Discovery review' },
      { date: '2026-09-30', hours: 1, worker: name },
    ],
    expected: () => [
      'The columns are found by header, not position.',
      'Line 1: flagged, two identical entries could match; the reviewer picks one, and the other is listed as not billed.',
      'Lines 2-4: match; line 3\'s start and stop agree.',
      'Change line 4 to 1 h while entering: it is flagged straight away (log 0.75 h).',
      '2026-09-30 is left out as outside the period.',
      BLOCKING,
    ],
  },
  {
    file: '6-expert-26-CR-00245-wrong-period.xlsx',
    title: 'The wrong log: nothing in the billing period',
    target: EXPERT_MARCH,
    rows: (name) => [
      { date: '2025-12-09', hours: 2, worker: name },
      { date: '2025-12-02', hours: 3.5, worker: name },
    ],
    expected: () => [
      'Says no log entries fall in the billing period and suggests checking it is the right case\'s log.',
      'Lines 1-3: flagged, not in the log.',
    ],
  },
  {
    file: '7-not-a-time-log.xlsx',
    title: 'A spreadsheet that is not a time log',
    target: EXPERT_MARCH,
    rows: () => [],
    expected: () => ['Asks which columns hold the date, hours and person; nothing is compared until they are chosen.'],
  },
];

const usDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function targetName(target: Target): Promise<string> {
  const found = await db
    .select({ invoiceId: invoice.invoiceId, name: professional.displayName })
    .from(invoice)
    .innerJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(and(eq(invoice.caseNumberAsTyped, target.caseNumber), eq(invoice.periodStart, target.periodStart)));
  const matching = [];
  for (const row of found) {
    const lines = await db
      .select({ date: invoiceLine.serviceDate, hours: invoiceLine.quantity })
      .from(invoiceLine)
      .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
      .where(and(eq(invoiceLine.invoiceId, row.invoiceId), eq(invoiceLineTypes.code, 'time')))
      .orderBy(asc(invoiceLine.serviceDate), asc(invoiceLine.position));
    const same =
      lines.length === target.billed.length &&
      lines.every((line, index) => line.date === target.billed[index]![0] && Number(line.hours) === target.billed[index]![1]);
    if (same) matching.push(row);
  }
  if (matching.length !== 1 || !matching[0]!.name) {
    throw new Error(`Expected one seeded invoice for ${target.caseNumber} from ${target.periodStart} with the lines these logs test; run \`npm run seed\` first.`);
  }
  return matching[0]!.name;
}

const cells = (row: LogRow, id: number) => [
  `#${id}`,
  usDate(row.date),
  row.stop ?? '',
  row.start ?? '',
  row.hours,
  row.type ?? 'Attorney',
  row.worker,
  row.details ?? '',
];

async function write(testCase: TestCase, name: string, firstId: number): Promise<void> {
  const path = join(OUT_DIR, testCase.file);
  const rows = testCase.rows(name).map((row, index) => cells(row, firstId - index));
  if (testCase.file.endsWith('.csv')) {
    // Reordered, so the columns must be found by header.
    const order = [1, 6, 4, 7, 0, 3, 2, 5];
    const lines = [COLUMNS, ...rows].map((row) => order.map((index) => csvCell(row[index] ?? '')).join(','));
    writeFileSync(path, `${lines.join('\r\n')}\r\n`);
    return;
  }
  const sheet =
    rows.length > 0
      ? [COLUMNS.map((value) => ({ value, fontWeight: 'bold' as const })), ...rows.map((row) => row.map((value) => (typeof value === 'number' ? { value, type: Number } : { value })))]
      : [
          ['invoice_number', 'date', 'type', 'description', 'amount'].map((value) => ({ value, fontWeight: 'bold' as const })),
          [{ value: 'SYN-0001' }, { value: '2026-03-03' }, { value: 'expense' }, { value: 'Copies' }, { value: 12.5, type: Number }],
        ];
  writeFileSync(path, await writeXlsxFile(sheet, { sheet: 'Timekeeping Log' }).toBuffer());
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const notes = ['# Time log test cases', '', 'Generated by `npm run demo-time-logs` from the current demo seed. Upload each on the named invoice\'s review page.', ''];
  for (const [index, testCase] of CASES.entries()) {
    const name = await targetName(testCase.target);
    await write(testCase, name, 52000 - index * 100);
    notes.push(
      `## ${testCase.file}`,
      '',
      `${testCase.title}. Invoice from ${name}, case ${testCase.target.caseNumber}, period from ${testCase.target.periodStart}.`,
      '',
      ...testCase.expected(name).map((line) => `- ${line}`),
      '',
    );
  }
  writeFileSync(join(OUT_DIR, 'README.md'), notes.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${CASES.length} time logs and their expected results to ${OUT_DIR}.`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
