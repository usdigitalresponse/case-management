// Demo invoices uploaded as files, through the same steps a submitter takes,
// so the upload, check-the-lines and review-beside-the-file views have
// something to show on a fresh seed. The PDFs are drawn here from synthetic
// values and name the seed's own vendors and clients.
import { asc, eq, inArray } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { db } from './client';
import { caseAssignment, caseTable, expenseTypes, invoiceLine, invoiceLineTypes, person, professional } from './schema';
import { documentStore } from '../imports/documentStore';
import { createDraftFromUpload, getUploadRead, startUploadRead } from '../imports/splitByCase';
import { confirmInvoiceImport } from '../imports/invoiceImports';
import { submitInvoice, updateDraftInvoice } from '../billing/invoiceLifecycle';
import { createInvoice } from '../portal/createInvoice';
import type { PortalActor } from '../portal/portalActor';

interface Item {
  // Left blank to show a date taken from the billing period, with a warning.
  date?: string;
  timekeeper: string;
  description: string;
  hours?: number;
  rate?: number;
  amount: number;
}

interface DemoFile {
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  client: string;
  items: Item[];
  // A total that doesn't match the lines, as on a misread file.
  statedTotal?: number;
}

const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

function drawInvoice(file: DemoFile): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Invoice ${file.invoiceNumber}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.font('Helvetica-Bold').fontSize(18).text('Synthetic Legal Services LLP');
  doc.font('Helvetica').fontSize(9).fillColor('#444').text('100 Example Street, Sample City  ·  billing@example.invalid').fillColor('black');
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(14).text('INVOICE');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Invoice No: ${file.invoiceNumber}`);
  doc.text(`Invoice Date: ${usDate(file.periodEnd)}`);
  doc.text(`Billing Period: ${usDate(file.periodStart)} - ${usDate(file.periodEnd)}`);
  doc.text(`Client: ${file.client}`);
  doc.moveDown();
  doc.fontSize(9).table({
    columnStyles: (column) => ({ width: [62, 100, '*', 45, 60, 65][column] ?? '*' }),
    data: [
      ['Date', 'Timekeeper', 'Description', 'Hours', 'Rate', 'Amount'].map((text) => ({ text, font: { src: 'Helvetica-Bold' } })),
      ...file.items.map((item) => [
        item.date ? usDate(item.date) : '',
        item.timekeeper,
        item.description,
        item.hours === undefined ? '' : item.hours.toFixed(2),
        item.rate === undefined ? '' : money(item.rate),
        money(item.amount),
      ]),
    ],
  });
  const total = file.statedTotal ?? file.items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).text(`Total Due: ${money(total)}`, { align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#444').text('Synthetic invoice for a demo. Not a real bill.').fillColor('black');
  doc.end();
  return done;
}

function timeItem(timekeeper: string, rate: number, date: string, description: string, hours: number): Item {
  return { date, timekeeper, description, hours, rate, amount: Math.round(hours * rate * 100) / 100 };
}

// PDFs are read in the background queue; the seed waits for each.
async function upload(actor: PortalActor, fileName: string, bytes: Buffer): Promise<string> {
  const { uploadReadId } = await startUploadRead(db, documentStore, actor, { fileName, bytes });
  for (let waited = 0; waited < 120; waited += 1) {
    // eslint-disable-next-line no-await-in-loop
    const read = await getUploadRead(db, actor, uploadReadId);
    if (read.status === 'failed') {
      throw new Error(`Demo upload ${fileName} could not be read: ${read.failureMessage}`);
    }
    if (read.status === 'ready') {
      return uploadReadId;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Demo upload ${fileName} was still being read after a minute.`);
}

async function uploadDraft(actor: PortalActor, caseId: string | null, professionalId: string | null, file: DemoFile, fileName: string) {
  const uploadReadId = await upload(actor, fileName, await drawInvoice(file));
  return createDraftFromUpload(db, actor, {
    uploadReadId,
    caseId,
    professionalId,
    periodStart: file.periodStart,
    periodEnd: file.periodEnd,
    invoiceNumber: file.invoiceNumber,
  });
}

// A draft's lines as saved, in the shape a save sends them back.
async function draftLines(invoiceId: string) {
  const rows = await db
    .select({
      lineType: invoiceLineTypes.code,
      expenseTypeCode: expenseTypes.code,
      amount: invoiceLine.amount,
      serviceDate: invoiceLine.serviceDate,
      serviceDateInferred: invoiceLine.serviceDateInferred,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitRate: invoiceLine.unitRate,
      statedAmount: invoiceLine.statedAmount,
      timekeeperLabel: invoiceLine.timekeeperLabel,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      sourceLocation: invoiceLine.sourceLocation,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(invoiceLine.sourceLocation));
  return rows.map(({ expenseTypeCode, ...row }) => {
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
    return { ...defined, lineType: expenseTypeCode === 'mileage' ? 'mileage' : row.lineType };
  }) as Array<Record<string, unknown> & { quantity?: string; description?: string }>;
}

// Changes the second line's hours and removes the fourth, as a submitter
// checking the lines might.
async function changeLines(actor: PortalActor, invoiceId: string, file: DemoFile) {
  const lines = await draftLines(invoiceId);
  const [first, second, third, , ...rest] = lines;
  if (!first || !second || !third) {
    throw new Error('Expected a demo upload to read at least four lines.');
  }
  second.quantity = String(Number(second.quantity ?? 0) - 0.5);
  await updateDraftInvoice(db, actor, invoiceId, {
    periodStart: file.periodStart,
    periodEnd: file.periodEnd,
    lines: [first, second, third, ...rest],
  });
}

async function clientOf(caseId: string): Promise<string> {
  const [row] = await db
    .select({ displayName: person.displayName })
    .from(caseTable)
    .innerJoin(person, eq(caseTable.clientId, person.personId))
    .where(eq(caseTable.caseId, caseId));
  return row?.displayName ?? 'Synthetic Client';
}

const fileNameFor = (client: string, month: string) => `Invoice_${client.replace(/[^A-Za-z]+/g, '_')}_${month}.pdf`;

export async function seedDemoUploads(input: {
  partner: PortalActor & { professionalId: string };
  colleague: { professionalId: string };
  staffUserAccountId: string;
}): Promise<void> {
  const { partner, colleague } = input;
  const nameOf = async (professionalId: string) =>
    (await db.select({ displayName: professional.displayName }).from(professional).where(eq(professional.professionalId, professionalId)))[0]
      ?.displayName ?? 'Synthetic Timekeeper';
  const caseOf = async (professionalId: string) =>
    (
      await db
        .select({ caseId: caseAssignment.caseId })
        .from(caseAssignment)
        .where(eq(caseAssignment.professionalId, professionalId))
        .orderBy(asc(caseAssignment.assignedAt))
    ).map((row) => row.caseId);
  const partnerName = await nameOf(partner.professionalId);
  const colleagueName = await nameOf(colleague.professionalId);
  const partnerCases = await caseOf(partner.professionalId);
  const [colleagueCase] = await caseOf(colleague.professionalId);
  const [firstCase, secondCase = firstCase] = partnerCases;
  if (!firstCase || !secondCase || !colleagueCase) {
    throw new Error('Expected demo cases for the uploads.');
  }
  // Lines must fall within the assignment for their dates to be kept.
  await db
    .update(caseAssignment)
    .set({ assignedAt: new Date('2026-06-01T00:00:00Z') })
    .where(inArray(caseAssignment.professionalId, [partner.professionalId, colleague.professionalId]));

  const rate = 125;
  const partnerItems = (month: string): Item[] => [
    timeItem(partnerName, rate, `2026-${month}-03`, 'Review of charging documents and discovery index', 1.5),
    timeItem(partnerName, rate, `2026-${month}-08`, 'Client meeting at the detention center', 2),
    timeItem(partnerName, rate, `2026-${month}-15`, 'Draft motion to suppress', 3.25),
    timeItem(partnerName, rate, `2026-${month}-22`, 'Status hearing preparation', 0.75),
    { date: `2026-${month}-24`, timekeeper: partnerName, description: 'Filing fee', amount: 45 },
  ];

  // Uploaded and not yet checked.
  const firstClient = await clientOf(firstCase);
  const untouched: DemoFile = { invoiceNumber: 'SYN-2026-0931', periodStart: '2026-09-01', periodEnd: '2026-09-30', client: firstClient, items: partnerItems('09') };
  await uploadDraft(partner, firstCase, partner.professionalId, untouched, fileNameFor(firstClient, 'Sep2026'));

  // Checked, with one line changed and one removed.
  const secondClient = await clientOf(secondCase);
  const changed: DemoFile = { invoiceNumber: 'SYN-2026-0932', periodStart: '2026-09-01', periodEnd: '2026-09-30', client: secondClient, items: partnerItems('09') };
  const changedDraft = await uploadDraft(partner, secondCase, partner.professionalId, changed, fileNameFor(secondClient, 'Sep2026'));
  await confirmInvoiceImport(db, documentStore, partner, changedDraft.invoiceImportId);
  await changeLines(partner, changedDraft.invoiceId, changed);

  // Misread: a line with no date, and a stated total the lines don't reach.
  const colleagueClient = await clientOf(colleagueCase);
  const misread: DemoFile = {
    invoiceNumber: 'SYN-2026-0940',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    client: colleagueClient,
    items: [
      timeItem(colleagueName, rate, '2026-09-04', 'Review of police reports', 2),
      { ...timeItem(colleagueName, rate, '2026-09-11', 'Witness interview', 1.25), date: undefined },
      timeItem(colleagueName, rate, '2026-09-18', 'Draft discovery request', 1),
    ],
    statedTotal: 712.5,
  };
  await uploadDraft(partner, colleagueCase, colleague.professionalId, misread, fileNameFor(colleagueClient, 'Sep2026'));

  // Sent with changes, waiting for a reviewer to take it.
  const sent: DemoFile = { invoiceNumber: 'SYN-2026-0831', periodStart: '2026-08-01', periodEnd: '2026-08-31', client: firstClient, items: partnerItems('08') };
  const sentDraft = await uploadDraft(partner, firstCase, partner.professionalId, sent, fileNameFor(firstClient, 'Aug2026'));
  await confirmInvoiceImport(db, documentStore, partner, sentDraft.invoiceImportId);
  await changeLines(partner, sentDraft.invoiceId, sent);
  await submitInvoice(db, partner, sentDraft.invoiceId, { attested: true });

  // Entered by hand, with no file.
  await createInvoice(db, partner, {
    caseId: secondCase,
    submit: false,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    lines: [
      { lineType: 'other', serviceDate: '2026-10-06', description: 'Copies of discovery for the client', amount: 32.4 },
      { lineType: 'other', serviceDate: '2026-10-14', description: 'Transcript of preliminary hearing', amount: 186 },
    ],
  });

  // Received by email and uploaded by staff, waiting on Intake for a case.
  const staff: PortalActor = { userAccountId: input.staffUserAccountId, professionalId: undefined };
  const held: DemoFile = { invoiceNumber: 'SYN-2026-1007', periodStart: '2026-10-01', periodEnd: '2026-10-31', client: 'Synthetic Client', items: partnerItems('10').slice(0, 4) };
  await uploadDraft(staff, null, null, held, 'Emailed_invoice_Oct2026.pdf');
}
