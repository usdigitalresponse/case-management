// Regenerates the synthetic PDF invoices in scenarios/fixtures/invoices/
// and their entries in expected.json, from the data below. Each layout
// imitates a common way invoices are laid out, not any product's template.
// Run after changing the data or layouts: npm run generate-sample-pdfs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');
// Fixed so regenerating unchanged data produces the same files.
const CREATED = new Date('2026-03-01T00:00:00Z');

interface Item {
  date?: string;
  type: 'time' | 'expense' | 'other';
  timekeeper?: string;
  description: string;
  hours?: number;
  rate?: number;
  amount: number;
  task?: string;
  activity?: string;
  expense?: string;
}

interface Sample {
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  items: Item[];
}

const A = 'Synthetic Timekeeper A';
const B = 'Synthetic Timekeeper B';

const BASE_ITEMS: Item[] = [
  { date: '2026-01-05', type: 'time', timekeeper: A, description: 'Initial case assessment and review of charging documents', hours: 1.5, rate: 200, amount: 300, task: 'L110', activity: 'A104' },
  { date: '2026-01-07', type: 'time', timekeeper: B, description: 'Research on suppression standard', hours: 2.25, rate: 150, amount: 337.5, task: 'L120', activity: 'A102' },
  { date: '2026-01-12', type: 'time', timekeeper: A, description: 'Client meeting to review discovery and next steps before the status hearing', hours: 1, rate: 200, amount: 200, task: 'L210', activity: 'A106' },
  { date: '2026-01-15', type: 'time', timekeeper: B, description: 'Draft motion to continue', hours: 0.75, rate: 150, amount: 112.5, task: 'L250', activity: 'A103' },
  { date: '2026-01-20', type: 'expense', timekeeper: A, description: 'Filing fee', amount: 45, expense: 'E112' },
  { date: '2026-01-22', type: 'expense', timekeeper: A, description: 'Mileage to courthouse', amount: 18.9, expense: 'E109' },
];

const total = (items: Item[]) => items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function newDocument(title: string) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: title, CreationDate: CREATED } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

function header(doc: PDFKit.PDFDocument, sample: Sample) {
  doc.font('Helvetica-Bold').fontSize(18).text('Synthetic Legal Services LLP');
  doc.font('Helvetica').fontSize(9).fillColor('#444').text('100 Example Street, Sample City  ·  billing@example.invalid').fillColor('black');
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(14).text('INVOICE');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Invoice No: ${sample.invoiceNumber}`);
  doc.text(`Invoice Date: ${usDate('2026-02-01')}`);
  doc.text(`Billing Period: ${usDate(sample.periodStart)} - ${usDate(sample.periodEnd)}`);
  doc.text('Matter: Synthetic Matter 1  ·  Client: Synthetic Client');
  doc.moveDown();
}

function footerTotal(doc: PDFKit.PDFDocument, amount: number) {
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).text(`Total Due: ${money(amount)}`, { align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#444').text('Synthetic invoice for testing. Not a real bill.').fillColor('black');
}

function table(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], widths: Array<number | string>) {
  doc.fontSize(9).table({
    columnStyles: (column) => ({ width: widths[column] ?? '*' }),
    data: [headers.map((text) => ({ text, font: { src: 'Helvetica-Bold' } })), ...rows],
  });
}

const itemRow = (item: Item) => [
  item.date ? usDate(item.date) : '',
  item.timekeeper ?? '',
  item.description,
  item.hours === undefined ? '' : item.hours.toFixed(2),
  item.rate === undefined ? '' : money(item.rate),
  money(item.amount),
];

async function itemized(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic itemized invoice');
  header(doc, sample);
  table(doc, ['Date', 'Timekeeper', 'Description', 'Hours', 'Rate', 'Amount'], sample.items.map(itemRow), [62, 100, '*', 45, 60, 65]);
  footerTotal(doc, total(sample.items));
  doc.end();
  return done;
}

async function coded(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic coded invoice');
  header(doc, sample);
  table(
    doc,
    ['Date', 'Task', 'Activity', 'Timekeeper', 'Description', 'Hours', 'Rate', 'Amount'],
    sample.items.map((item) => {
      const [date, timekeeper, description, hours, rate, amount] = itemRow(item);
      return [date!, item.task ?? item.expense ?? '', item.activity ?? '', timekeeper!, description!, hours!, rate!, amount!];
    }),
    [58, 36, 44, 90, '*', 38, 52, 58],
  );
  footerTotal(doc, total(sample.items));
  doc.end();
  return done;
}

// Hours per timekeeper and expenses in total: no dates or item detail.
function summaryItems(items: Item[]): Item[] {
  const byTimekeeper = new Map<string, Item>();
  for (const item of items.filter((i) => i.type === 'time')) {
    const key = `${item.timekeeper}|${item.rate}`;
    const current = byTimekeeper.get(key);
    byTimekeeper.set(key, {
      type: 'time',
      timekeeper: item.timekeeper,
      description: `Professional services: ${item.timekeeper}`,
      hours: (current?.hours ?? 0) + (item.hours ?? 0),
      rate: item.rate,
      amount: (current?.amount ?? 0) + item.amount,
    });
  }
  const expenses = items.filter((i) => i.type === 'expense');
  return [
    ...byTimekeeper.values(),
    { type: 'expense', description: 'Expenses', amount: total(expenses) },
  ];
}

async function summary(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic summary invoice');
  header(doc, sample);
  doc.font('Helvetica-Bold').fontSize(11).text('Summary of Services').moveDown(0.3);
  table(
    doc,
    ['Timekeeper', 'Description', 'Hours', 'Rate', 'Amount'],
    sample.items.map((item) => [item.timekeeper ?? '', item.description, item.hours?.toFixed(2) ?? '', item.rate ? money(item.rate) : '', money(item.amount)]),
    [110, '*', 50, 60, 70],
  );
  footerTotal(doc, total(sample.items));
  doc.end();
  return done;
}

// A fixed claim form with labelled boxes rather than an item table, like
// appointed-counsel compensation vouchers.
async function voucher(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic compensation voucher');
  doc.font('Helvetica-Bold').fontSize(14).text('CLAIM FOR COMPENSATION OF APPOINTED COUNSEL', { align: 'center' });
  doc.font('Helvetica').fontSize(9).text('Synthetic form for testing', { align: 'center' }).moveDown();
  doc.fontSize(10);
  doc.text(`Voucher Number: ${sample.invoiceNumber}`);
  doc.text(`Counsel: ${A}`);
  doc.text(`Period of Service: From ${usDate(sample.periodStart)} To ${usDate(sample.periodEnd)}`).moveDown();
  const [inCourt, outOfCourt, travel] = sample.items;
  table(
    doc,
    ['Category', 'Hours', 'Rate', 'Amount Claimed'],
    [
      ['a. In-Court Hearings', inCourt!.hours!.toFixed(1), money(inCourt!.rate!), money(inCourt!.amount)],
      ['b. Out-of-Court: Interviews, Research, Preparation', outOfCourt!.hours!.toFixed(1), money(outOfCourt!.rate!), money(outOfCourt!.amount)],
      ['c. Travel Expenses', '', '', money(travel!.amount)],
    ],
    ['*', 60, 70, 100],
  );
  doc.moveDown().font('Helvetica-Bold').text(`Total Amount Claimed: ${money(total(sample.items))}`);
  doc.font('Helvetica').moveDown().text('I certify that the above claim is correct. (Synthetic signature line)');
  doc.end();
  return done;
}

// Time and expenses in separate tables, each with its own column headings
// and subtotal; timekeepers as initials; an activity column; amounts right
// aligned; a no-charge entry. A common practice-management layout.
async function sectioned(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic sectioned invoice');
  header(doc, sample);
  const section = (title: string, quantityHeading: string, items: Item[], extra: string[][] = []) => {
    doc.font('Helvetica-Bold').fontSize(11).text(title).moveDown(0.2);
    doc.fontSize(9).table({
      columnStyles: (column) => ({
        width: [62, 34, 70, '*', 55, 50, 70][column] ?? '*',
        align: column >= 4 ? { x: 'right' } : { x: 'left' },
      }),
      data: [
        ['DATE', 'EE', 'ACTIVITY', 'DESCRIPTION', 'RATE', quantityHeading, 'LINE TOTAL'].map((text) => ({ text, font: { src: 'Helvetica-Bold' } })),
        ...items.map((item) => [
          usDate(item.date!),
          item.timekeeper ?? '',
          item.type === 'time' ? 'Legal work' : 'Expense',
          item.description,
          money(item.rate ?? item.amount),
          (item.hours ?? 1).toFixed(2),
          money(item.amount),
        ]),
        ...extra,
      ],
    });
    doc.font('Helvetica-Bold').fontSize(9).text(`${title === 'Time Entries' ? 'Totals' : 'Expense total'}: ${money(total(items))}`, { align: 'right' });
    doc.moveDown();
  };
  const time = sample.items.filter((item) => item.type === 'time');
  section('Time Entries', 'HOURS', time, [[usDate('2026-01-16'), 'SA', 'Legal work', 'Courtesy call (no charge)', '$0.00', '0.20', '$0.00']]);
  section('Expenses', 'QUANTITY', sample.items.filter((item) => item.type === 'expense'));
  doc.font('Helvetica').fontSize(10).text(`Time Entry Sub-Total: ${money(total(time))}`, { align: 'right' });
  footerTotal(doc, total(sample.items));
  doc.end();
  return done;
}

// Section titles head the first column ("Time Entries | Billed By | Price
// | Qty | Sub") and each item stacks activity, date and description in it.
async function stacked(sample: Sample): Promise<Buffer> {
  const { doc, done } = newDocument('Synthetic stacked invoice');
  header(doc, sample);
  const section = (title: string, items: Item[]) => {
    doc.fontSize(9).table({
      columnStyles: (column) => ({ width: ['*', 110, 60, 45, 70][column] ?? '*', align: column >= 2 ? { x: 'right' } : { x: 'left' } }),
      data: [
        [title, 'Billed By', 'Price', 'Qty', 'Sub'].map((text) => ({ text, font: { src: 'Helvetica-Bold' } })),
        ...items.map((item) => [
          // The sample's description starts with the activity; print it on
          // its own first line, then the date, then the rest.
          item.description.replace(/^(Legal work|Expense) /, `$1\n${usDate(item.date!)}\n`),
          item.timekeeper ?? '',
          money(item.rate!),
          item.hours!.toFixed(2),
          money(item.amount),
        ]),
      ],
    });
    doc.font('Helvetica-Bold').text(`${title} Total: ${money(total(items))}`, { align: 'right' }).moveDown();
  };
  section('Time Entries', sample.items.filter((item) => item.type === 'time'));
  section('Expenses', sample.items.filter((item) => item.type === 'expense'));
  footerTotal(doc, total(sample.items));
  doc.end();
  return done;
}

interface Layout {
  file: string;
  sample: Sample;
  render: (sample: Sample) => Promise<Buffer>;
  shows: string;
}

const LONG_ITEMS: Item[] = Array.from({ length: 48 }, (_, index) => {
  const base = BASE_ITEMS[index % 4]!;
  const day = String((index % 27) + 1).padStart(2, '0');
  return { ...base, date: `2026-03-${day}`, description: `${base.description} (${index + 1})` };
});

const LAYOUTS: Layout[] = [
  {
    file: 'pdf-itemized.pdf',
    sample: { invoiceNumber: 'SAMPLE-PDF-001', periodStart: '2026-01-01', periodEnd: '2026-01-31', items: BASE_ITEMS },
    render: itemized,
    shows: 'An itemized table with dates, timekeepers, hours, rates and a description that wraps',
  },
  {
    file: 'pdf-coded.pdf',
    sample: { invoiceNumber: 'SAMPLE-PDF-002', periodStart: '2026-01-01', periodEnd: '2026-01-31', items: BASE_ITEMS },
    render: coded,
    shows: 'The same items with UTBMS task and activity code columns',
  },
  {
    file: 'pdf-summary.pdf',
    sample: { invoiceNumber: 'SAMPLE-PDF-003', periodStart: '2026-01-01', periodEnd: '2026-01-31', items: summaryItems(BASE_ITEMS) },
    render: summary,
    shows: 'Totals per timekeeper and for expenses, with no dates or item detail',
  },
  {
    file: 'pdf-voucher.pdf',
    sample: {
      invoiceNumber: 'SAMPLE-VOUCHER-004',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      items: [
        { type: 'time', timekeeper: A, description: 'In-Court Hearings', hours: 3.5, rate: 100, amount: 350 },
        { type: 'time', timekeeper: A, description: 'Out-of-Court: Interviews, Research, Preparation', hours: 6, rate: 100, amount: 600 },
        { type: 'expense', timekeeper: A, description: 'Travel Expenses', amount: 42.5 },
      ],
    },
    render: voucher,
    shows: 'A fixed claim form with labelled categories instead of an item table',
  },
  {
    file: 'pdf-sectioned.pdf',
    sample: {
      invoiceNumber: 'SAMPLE-PDF-006',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      // Initials for timekeepers; expenses shown as quantity 1 at their cost.
      items: BASE_ITEMS.map((item) => ({
        ...item,
        timekeeper: item.timekeeper === A ? 'SA' : 'SB',
        hours: item.hours ?? 1,
        rate: item.rate ?? item.amount,
        task: undefined,
        activity: undefined,
      })),
    },
    render: sectioned,
    shows: 'Separate time and expense tables with their own headings and subtotals, initials for timekeepers, an activity column, right-aligned amounts and a no-charge entry',
  },
  {
    file: 'pdf-stacked.pdf',
    sample: {
      invoiceNumber: 'SAMPLE-PDF-007',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      // The stacked cell's first line, the activity, reads as the start of
      // the description.
      items: BASE_ITEMS.map((item) => ({
        ...item,
        description: `${item.type === 'time' ? 'Legal work' : 'Expense'} ${item.description}`,
        hours: item.hours ?? 1,
        rate: item.rate ?? item.amount,
        task: undefined,
        activity: undefined,
      })),
    },
    render: stacked,
    shows: 'Section titles heading the first column, and each item stacking activity, date and description in one cell',
  },
  {
    file: 'pdf-multipage.pdf',
    sample: { invoiceNumber: 'SAMPLE-PDF-005', periodStart: '2026-03-01', periodEnd: '2026-03-31', items: LONG_ITEMS },
    render: itemized,
    shows: 'A 48-item table running across pages, with the column header on the first page only',
  },
];

function expectedFor(sample: Sample) {
  return {
    format: 'document',
    document: {
      invoiceNumber: sample.invoiceNumber,
      periodStart: sample.periodStart,
      periodEnd: sample.periodEnd,
      statedTotal: total(sample.items).toFixed(2),
      lines: sample.items.map((item) => ({
        lineType: item.type,
        serviceDate: item.date,
        timekeeper: item.timekeeper,
        description: item.description,
        quantity: item.hours,
        unitRate: item.rate,
        amount: item.amount.toFixed(2),
      })),
    },
  };
}

async function main() {
  const expectedPath = join(SAMPLES_DIR, 'expected.json');
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, unknown>;
  for (const layout of LAYOUTS) {
    writeFileSync(join(SAMPLES_DIR, layout.file), await layout.render(layout.sample));
    expected[layout.file] = { ...(expected[layout.file] as object | undefined), ...expectedFor(layout.sample), shows: layout.shows };
  }
  writeFileSync(expectedPath, `${JSON.stringify(expected, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${LAYOUTS.length} PDFs and their expected values to ${SAMPLES_DIR}`);
}

void main();
