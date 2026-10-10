import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { submitInvoice, updateDraftInvoice, InvoiceStateError } from '../src/billing/invoiceLifecycle';
import {
  confirmInvoiceImport,
  discardInvoiceImport,
  expireInvoiceImports,
  getInvoiceImport,
  IMPORT_EXPIRY_MS,
  uploadInvoiceFile,
} from '../src/imports/invoiceImports';
import { parseLedes1998b } from '../src/imports/parseLedes';
import { parseTemplateCsv, parseTemplateXlsx } from '../src/imports/parseSpreadsheet';
import { detectInvoiceFile, UnsupportedInvoiceFileError } from '../src/imports/detectFormat';
import { UnreadableInvoiceFileError } from '../src/imports/parsedInvoice';
import type { DocumentStore } from '../src/imports/documentStore';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { ValidationError } from '../src/errors';
import {
  caseAssignment,
  document,
  invoice,
  invoiceEvent,
  invoiceImport,
  invoiceLine,
  invoiceStatuses,
  timeEntry,
  userAccount,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

// A page with a drawn shape and no text, like a scan without OCR.
function blankPdf(): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.rect(72, 72, 200, 100).fill('#999');
  doc.end();
  return done;
}

function memoryStore(): DocumentStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(bytes) {
      const reference = `memory:${randomUUID()}`;
      files.set(reference, bytes);
      return reference;
    },
    async get(reference) {
      return files.get(reference);
    },
    async delete(reference) {
      files.delete(reference);
    },
  };
}

const LEDES_HEADER =
  'INVOICE_DATE|INVOICE_NUMBER|CLIENT_ID|LAW_FIRM_MATTER_ID|INVOICE_TOTAL|BILLING_START_DATE|BILLING_END_DATE|INVOICE_DESCRIPTION|LINE_ITEM_NUMBER|EXP/FEE/INV_ADJ_TYPE|LINE_ITEM_NUMBER_OF_UNITS|LINE_ITEM_ADJUSTMENT_AMOUNT|LINE_ITEM_TOTAL|LINE_ITEM_DATE|LINE_ITEM_TASK_CODE|LINE_ITEM_EXPENSE_CODE|LINE_ITEM_ACTIVITY_CODE|TIMEKEEPER_ID|LINE_ITEM_DESCRIPTION|LAW_FIRM_ID|LINE_ITEM_UNIT_COST|TIMEKEEPER_NAME|TIMEKEEPER_CLASSIFICATION|CLIENT_MATTER_ID';

function ledesLine(fields: { number?: string; total?: string; item: string; type: string; units: string; amount: string; date: string; task?: string; expense?: string; timekeeper: string; description: string; rate: string }) {
  return [
    '20260205', fields.number ?? 'SAMPLE-INV-1', 'CLIENT-1', 'MATTER-1', fields.total ?? '190.00', '20260101', '20260131', 'Synthetic invoice',
    fields.item, fields.type, fields.units, '0', fields.amount, fields.date, fields.task ?? '', fields.expense ?? '', '', 'TK1',
    fields.description, 'FIRM-1', fields.rate, fields.timekeeper, 'PT', 'CM-1',
  ].join('|');
}

function syntheticLedes(timekeeper: string, extra: { total?: string; number?: string } = {}): string {
  return [
    'LEDES1998B[]',
    `${LEDES_HEADER}[]`,
    `${ledesLine({ ...extra, item: '1', type: 'F', units: '1.5', amount: '150.00', date: '20260110', task: 'SAMPLE-TASK', timekeeper, description: 'Synthetic research', rate: '100.00' })}[]`,
    `${ledesLine({ ...extra, item: '2', type: 'E', units: '1', amount: '40.00', date: '20260112', expense: 'SAMPLE-EXP', timekeeper, description: 'Synthetic filing fee', rate: '40.00' })}[]`,
    '',
  ].join('\n');
}

describe('structured invoice parsers', () => {
  it('reads a LEDES 1998B file by field name', () => {
    const parsed = parseLedes1998b(syntheticLedes('Synthetic Timekeeper'));
    expect(parsed).toMatchObject({ invoiceNumber: 'SAMPLE-INV-1', periodStart: '2026-01-01', periodEnd: '2026-01-31', statedTotal: 190 });
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      location: 'line 3', lineType: 'time', serviceDate: '2026-01-10', quantity: 1.5, unitRate: 100, amount: 150,
      taskCode: 'SAMPLE-TASK', timekeeperLabel: 'Synthetic Timekeeper',
    });
    expect(parsed.lines[1]).toMatchObject({ lineType: 'expense', expenseCode: 'SAMPLE-EXP', amount: 40 });
  });

  it('rejects LEDES files covering several invoices or with negative items', () => {
    const two = syntheticLedes('A').replace('|2|E|', '|2|E|').replace(/SAMPLE-INV-1(?=[^\n]*\|2\|E\|)/, 'SAMPLE-INV-2');
    expect(() => parseLedes1998b(two)).toThrow(UnreadableInvoiceFileError);
    const credit = syntheticLedes('A').replace('|40.00|20260112', '|-40.00|20260112');
    expect(() => parseLedes1998b(credit)).toThrow(
      expect.objectContaining({ fieldErrors: { file: expect.stringMatching(/positive total/) } }),
    );
  });

  it('reads the CSV template, including quoted fields', () => {
    const parsed = parseTemplateCsv(
      'Date,Description,Timekeeper,Hours,Rate,Amount,Expense_Code\n2026-01-10,"Research, drafting",Synthetic Timekeeper,2,50,100,\n2026-01-11,"Copies ""bulk""",,,,12.5,SAMPLE-EXP\n\n',
    );
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({ location: 'row 2', lineType: 'time', description: 'Research, drafting', amount: 100 });
    expect(parsed.lines[1]).toMatchObject({ lineType: 'expense', description: 'Copies "bulk"', amount: 12.5 });
  });

  it('reads the XLSX template', async () => {
    const bytes = await writeXlsxFile([
      [{ value: 'date' }, { value: 'type' }, { value: 'amount' }],
      [{ value: '2026-01-10' }, { value: 'other' }, { value: 75, type: Number }],
    ]).toBuffer();
    const parsed = await parseTemplateXlsx(bytes);
    expect(parsed.lines).toEqual([expect.objectContaining({ lineType: 'other', amount: 75, serviceDate: '2026-01-10' })]);
  });

  it('detects formats from content and refuses unsupported files', () => {
    expect(detectInvoiceFile(Buffer.from(syntheticLedes('A'))).format).toBe('ledes_1998b');
    expect(detectInvoiceFile(Buffer.from('amount\n10\n')).format).toBe('spreadsheet');
    expect(detectInvoiceFile(Buffer.from('%PDF-1.7 synthetic')).format).toBe('document');
    expect(() => detectInvoiceFile(Buffer.from('just some notes'))).toThrow(UnsupportedInvoiceFileError);
    expect(() => detectInvoiceFile(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook vbaProject.bin')]))).toThrow(
      /macros/,
    );
  });
});

describe('invoice import workflow', () => {
  async function setup(displayName = 'Synthetic Timekeeper') {
    const [account] = await testDb
      .insert(userAccount)
      .values({ displayName, email: `${randomUUID()}@example.com`, active: true })
      .returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, displayName);
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-01T12:00:00Z'),
    });
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    const actor: PortalActor = await resolvePortalActor(testDb, account!.userAccountId);
    return { actor, caseId, professionalId, store: memoryStore() };
  }

  async function statusOf(invoiceId: string) {
    const [row] = await testDb
      .select({ code: invoiceStatuses.code })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId));
    return row?.code;
  }

  it('turns a LEDES file into a draft, then confirms, deletes the file and creates time on submission', async () => {
    const { actor, caseId, professionalId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'synthetic.ledes', bytes: Buffer.from(syntheticLedes('synthetic timekeeper')),
    });
    expect(uploaded.status).toBe('extracted');
    const invoiceId = uploaded.invoiceId as string;
    expect(await statusOf(invoiceId)).toBe('draft');
    expect(store.files.size).toBe(1);

    // The exact display-name match is suggested for both lines.
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)).orderBy(asc(invoiceLine.serviceDate));
    expect(lines.map((line) => line.timekeeperProfessionalId)).toEqual([professionalId, professionalId]);

    await expect(submitInvoice(testDb, actor, invoiceId)).rejects.toThrow(InvoiceStateError);

    await confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId);
    expect(store.files.size).toBe(0);
    const [doc] = await testDb.select().from(document);
    expect(doc?.contentDeletedAt).not.toBeNull();

    await submitInvoice(testDb, actor, invoiceId);
    const entries = await testDb.select().from(timeEntry).where(eq(timeEntry.sourceInvoiceImportId, uploaded.invoiceImportId));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ professionalId, activityOn: '2026-01-10', durationHours: '1.50' });
    const [timeLine] = await testDb.select().from(invoiceLine).where(eq(invoiceLine.sourceTimeEntryId, entries[0]!.timeEntryId));
    expect(timeLine?.invoiceId).toBe(invoiceId);
  });

  it('suggests "Last, First" names and, for unnamed lines, the billed professional', async () => {
    const { actor, caseId, professionalId, store } = await setup();
    const named = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'x.ledes', bytes: Buffer.from(syntheticLedes('TIMEKEEPER, SYNTHETIC')),
    });
    const unnamed = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'x.csv', bytes: Buffer.from('amount,description\n10,Synthetic item\n'),
    });
    for (const invoiceId of [named.invoiceId, unnamed.invoiceId]) {
      const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId as string));
      expect(lines.every((line) => line.timekeeperProfessionalId === professionalId)).toBe(true);
    }
  });

  it('blocks confirmation until every line is matched, and records warnings', async () => {
    const { actor, caseId, professionalId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'x.ledes', bytes: Buffer.from(syntheticLedes('Unknown Person', { total: '999.00' })),
    });
    const detail = await getInvoiceImport(testDb, actor, uploaded.invoiceImportId);
    const warnings = (detail.extractionResult as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code);
    expect(warnings).toContain('stated_total_mismatch');

    await expect(confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId)).rejects.toThrow(ValidationError);
    // Editing an unconfirmed import's draft doesn't fill matches in silently.
    await updateDraftInvoice(testDb, actor, uploaded.invoiceId as string, { lines: [{ amount: 150, lineType: 'time' }] });
    await expect(confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId)).rejects.toThrow(ValidationError);

    await updateDraftInvoice(testDb, actor, uploaded.invoiceId as string, {
      lines: [{ amount: 150, lineType: 'time', timekeeperProfessionalId: professionalId }],
    });
    await confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId);
  });

  // Saving a draft replaces its lines, so a field the save path doesn't copy
  // is silently lost. Re-saving every line exactly as loaded must change nothing.
  it('keeps every supplier-stated field when an imported draft is saved back unchanged', async () => {
    const { actor, caseId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'x.ledes', bytes: Buffer.from(syntheticLedes('Synthetic Timekeeper')),
    });
    const invoiceId = uploaded.invoiceId as string;
    const comparable = async () =>
      (await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)).orderBy(asc(invoiceLine.serviceDate))).map(
        ({ invoiceLineId: _id, ...line }) => line,
      );
    const before = await comparable();
    const typeCodes = { time: 'time', expense: 'expense', service: 'other' } as const;
    const detail = await loadInvoiceDetail(testDb, invoiceId);

    await updateDraftInvoice(testDb, actor, invoiceId, {
      periodStart: detail!.invoice.periodStart ?? undefined,
      periodEnd: detail!.invoice.periodEnd ?? undefined,
      lines: detail!.lines.map((line) => ({
        lineType: typeCodes[line.lineTypeCode as keyof typeof typeCodes],
        amount: Number(line.amount),
        serviceDate: line.serviceDate ?? undefined,
        description: line.description ?? undefined,
        quantity: line.quantity === null ? undefined : Number(line.quantity),
        unitRate: line.unitRate === null ? undefined : Number(line.unitRate),
        timekeeperLabel: line.timekeeperLabel ?? undefined,
        timekeeperProfessionalId: line.timekeeperProfessionalId ?? undefined,
        taskCode: line.taskCode ?? undefined,
        activityCode: line.activityCode ?? undefined,
        expenseCode: line.expenseCode ?? undefined,
        sourceTimeEntryId: line.sourceTimeEntryId ?? undefined,
      })),
    });

    expect(await comparable()).toEqual(before);
    // Every editable invoice_line column is exercised by this file.
    expect(before[0]).toMatchObject({ unitRate: '100.00', timekeeperLabel: 'Synthetic Timekeeper', taskCode: 'SAMPLE-TASK' });
    expect(before[1]).toMatchObject({ expenseCode: 'SAMPLE-EXP' });
  });

  it('reads a PDF into a draft, recording how it was read', async () => {
    const { actor, caseId, professionalId, store } = await setup('Synthetic Timekeeper A');
    const bytes = readFileSync(join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices', 'pdf-itemized.pdf'));
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'invoice.pdf', bytes });
    expect(uploaded.status).toBe('extracted');

    const detail = await getInvoiceImport(testDb, actor, uploaded.invoiceImportId);
    expect(detail).toMatchObject({ formatCode: 'document', mediaType: 'application/pdf', extractionMethod: 'pdf-text-layer 1' });
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, uploaded.invoiceId as string));
    expect(lines).toHaveLength(6);
    // "Synthetic Timekeeper A" is the professional's own name; B matches no one.
    expect(lines.filter((line) => line.timekeeperProfessionalId === professionalId)).toHaveLength(4);
  });

  it('marks a PDF with no text as unreadable and keeps it until discarded', async () => {
    const { actor, caseId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'scan.pdf', bytes: await blankPdf() });
    expect(uploaded).toMatchObject({ status: 'failed', invoiceId: null });
    const detail = await getInvoiceImport(testDb, actor, uploaded.invoiceImportId);
    expect(JSON.stringify(detail.extractionResult)).toMatch(/no readable text/);
  });

  it('warns about a file uploaded twice', async () => {
    const { actor, caseId, store } = await setup();
    const bytes = Buffer.from(syntheticLedes('Synthetic Timekeeper'));
    await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'a', bytes });
    const second = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'b', bytes });
    const detail = await getInvoiceImport(testDb, actor, second.invoiceImportId);
    const warnings = (detail.extractionResult as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code);
    expect(warnings).toEqual(expect.arrayContaining(['duplicate_file', 'duplicate_invoice_number']));
  });

  it('keeps an unreadable file until discarded, then deletes it', async () => {
    const { actor, caseId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, {
      caseId, fileName: 'bad.csv', bytes: Buffer.from('amount,date\n10,not-a-date\n'),
    });
    expect(uploaded).toMatchObject({ status: 'failed', invoiceId: null });
    expect(store.files.size).toBe(1);
    await discardInvoiceImport(testDb, store, actor, uploaded.invoiceImportId);
    expect(store.files.size).toBe(0);
  });

  it('discarding withdraws the unconfirmed draft', async () => {
    const { actor, caseId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'a', bytes: Buffer.from('amount\n10\n') });
    await discardInvoiceImport(testDb, store, actor, uploaded.invoiceImportId);
    expect(await statusOf(uploaded.invoiceId as string)).toBe('withdrawn');
    await expect(confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId)).rejects.toThrow(InvoiceStateError);
  });

  it('expires unresolved imports after three days as a system action', async () => {
    const { actor, caseId, store } = await setup();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'a', bytes: Buffer.from('amount\n10\n') });

    expect(await expireInvoiceImports(testDb, store, new Date(Date.now() + IMPORT_EXPIRY_MS - 60_000))).toBe(0);
    expect(await expireInvoiceImports(testDb, store, new Date(Date.now() + IMPORT_EXPIRY_MS + 60_000))).toBe(1);

    expect(store.files.size).toBe(0);
    expect(await statusOf(uploaded.invoiceId as string)).toBe('withdrawn');
    const [row] = await testDb.select().from(invoiceImport).where(eq(invoiceImport.invoiceImportId, uploaded.invoiceImportId));
    expect(row?.resolvedByUserAccountId).toBeNull();
    const events = await testDb.select().from(invoiceEvent).where(eq(invoiceEvent.invoiceId, uploaded.invoiceId as string));
    const withdrawal = events.find((event) => event.actorUserAccountId === null);
    expect(withdrawal?.reason).toMatch(/expired/);
  });

  it("hides another user's import", async () => {
    const owner = await setup();
    const other = await setup('Other Professional');
    const uploaded = await uploadInvoiceFile(testDb, owner.store, owner.actor, {
      caseId: owner.caseId, fileName: 'a', bytes: Buffer.from('amount\n10\n'),
    });
    await expect(getInvoiceImport(testDb, other.actor, uploaded.invoiceImportId)).rejects.toThrow(/Import not found/);
    await expect(discardInvoiceImport(testDb, owner.store, other.actor, uploaded.invoiceImportId)).rejects.toThrow(/Import not found/);
  });
});
