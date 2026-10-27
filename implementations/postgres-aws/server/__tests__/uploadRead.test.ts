import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import {
  CaseSplitReadNotFoundError,
  createDraftFromUpload,
  discardUploadRead,
  getCaseSplitRead,
  getUploadRead,
  startUploadRead,
} from '../src/imports/splitByCase';
import { extractionsSettled } from '../src/imports/extractionJobs';
import { deleteUnsubmittedInvoice } from '../src/billing/deleteInvoice';
import type { DocumentStore } from '../src/imports/documentStore';
import { ValidationError } from '../src/errors';
import { caseAssignment, caseTable, invoice, invoiceAttestation, invoiceImport, supportingInvoice, userAccount } from '../src/db/schema';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { ATTESTATION_STATEMENT, submitInvoice, updateDraftInvoice } from '../src/billing/invoiceLifecycle';
import { confirmInvoiceImport } from '../src/imports/invoiceImports';
import { createInvoice } from '../src/portal/createInvoice';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

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
    async list() {
      return [...files.keys()];
    },
  };
}

async function createProfessional(name: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: name, email: `${randomUUID()}@example.com`, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, name);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), professionalId };
}

async function caseFor(professionalId: string, externalReference: string) {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-01T12:00:00Z'),
  });
  await testDb.update(caseTable).set({ externalReference }).where(eq(caseTable.caseId, caseId));
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date('2026-01-01T12:00:00Z'),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return caseId;
}

const CSV = Buffer.from(
  ['date,type,description,hours,amount', '2026-01-10,time,Research,1.5,150', '2026-01-11,expense,Filing fee,,40', ''].join('\n'),
);

async function upload(actor: PortalActor, fileName: string, store = memoryStore()) {
  const { uploadReadId } = await startUploadRead(testDb, store, actor, { fileName, bytes: CSV });
  await extractionsSettled();
  const read = await getUploadRead(testDb, actor, uploadReadId);
  if (read.status !== 'ready') {
    throw new Error(`Expected a finished read, got ${read.status}`);
  }
  return { uploadReadId, store, read };
}

describe('uploading an invoice before choosing its case', () => {
  it('needs an open case to bill', async () => {
    const { actor } = await createProfessional('Synthetic Attorney');
    await expect(startUploadRead(testDb, memoryStore(), actor, { fileName: 'a.csv', bytes: CSV })).rejects.toBeInstanceOf(
      NotAssignedToCaseError,
    );
  });

  it('reads the file, lists only the uploader’s cases and suggests the only one', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const caseId = await caseFor(professionalId, 'CR-0001');
    const other = await createProfessional('Someone Else');
    await caseFor(other.professionalId, 'CR-0009');

    const { read } = await upload(actor, 'invoice.csv');
    expect(read.read.lineCount).toBe(2);
    expect(read.cases.map((row) => row.caseId)).toEqual([caseId]);
    expect(read.suggested).toEqual({ caseId, professionalId });
  });

  it('suggests a case named in the file name, and none when unclear', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    await caseFor(professionalId, 'CR-0001');
    const second = await caseFor(professionalId, 'CR-0002');

    expect((await upload(actor, 'Firm_CR-0002_Jan.csv')).read.suggested).toEqual({ caseId: second, professionalId });
    expect((await upload(actor, 'Firm_Jan.csv')).read.suggested).toBeNull();
  });

  it('makes one unconfirmed draft on the chosen case, with the checked period and invoice number', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const caseId = await caseFor(professionalId, 'CR-0001');
    const { uploadReadId, store } = await upload(actor, 'invoice.csv');

    const created = await createDraftFromUpload(testDb, actor, {
      uploadReadId,
      caseId,
      professionalId,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      invoiceNumber: ' INV-77 ',
    });

    const [draft] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, created.invoiceId));
    expect(draft).toMatchObject({ caseId, professionalId, periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    const [imported] = await testDb.select().from(invoiceImport).where(eq(invoiceImport.invoiceImportId, created.invoiceImportId));
    expect(imported?.invoiceId).toBe(created.invoiceId);
    const [supporting] = await testDb.select().from(supportingInvoice).where(eq(supportingInvoice.invoiceId, created.invoiceId));
    expect(supporting).toMatchObject({ invoiceNumber: 'INV-77', periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    // The file is kept for checking the lines.
    expect(store.files.size).toBe(1);
    // The read is used up.
    await expect(getUploadRead(testDb, actor, uploadReadId)).rejects.toBeInstanceOf(CaseSplitReadNotFoundError);

    // Deleting the draft takes its supporting invoice with it.
    await deleteUnsubmittedInvoice(testDb, store, actor, created.invoiceId);
    expect(await testDb.select().from(supportingInvoice)).toEqual([]);
  });

  it('refuses a case the uploader is not on, and a half-entered period', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const caseId = await caseFor(professionalId, 'CR-0001');
    const other = await createProfessional('Someone Else');
    const otherCase = await caseFor(other.professionalId, 'CR-0009');
    const { uploadReadId } = await upload(actor, 'invoice.csv');

    await expect(createDraftFromUpload(testDb, actor, { uploadReadId, caseId: otherCase, professionalId })).rejects.toBeInstanceOf(
      NotAssignedToCaseError,
    );
    await expect(
      createDraftFromUpload(testDb, actor, { uploadReadId, caseId, professionalId, periodStart: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Still there to try again.
    expect((await getUploadRead(testDb, actor, uploadReadId)).status).toBe('ready');
  });

  it('shows what the submitter changed from the file, and needs the true-and-correct tick to send', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const caseId = await caseFor(professionalId, 'CR-0001');
    const { uploadReadId, store } = await upload(actor, 'invoice.csv');
    const { invoiceId, invoiceImportId } = await createDraftFromUpload(testDb, actor, { uploadReadId, caseId, professionalId });

    const read = await loadInvoiceDetail(testDb, invoiceId);
    expect(read?.fileSource?.lines.map((line) => line.location)).toEqual(['row 2', 'row 3']);
    expect(read?.submitterChanges).toEqual({ changedCount: 0, removedCount: 0, addedCount: 0 });

    // Fewer hours on the time line; the filing fee removed.
    const time = read!.lines.find((line) => line.lineTypeCode === 'time')!;
    await updateDraftInvoice(testDb, actor, invoiceId, {
      lines: [{ lineType: 'time', serviceDate: time.serviceDate!, description: time.description!, quantity: 1, sourceLocation: time.sourceLocation! }],
    });
    const changed = await loadInvoiceDetail(testDb, invoiceId);
    expect(changed?.submitterChanges).toEqual({ changedCount: 1, removedCount: 1, addedCount: 0 });
    expect(changed?.lines).toHaveLength(1);

    await confirmInvoiceImport(testDb, store, actor, invoiceImportId);
    await expect(submitInvoice(testDb, actor, invoiceId)).rejects.toBeInstanceOf(ValidationError);
    await submitInvoice(testDb, actor, invoiceId, { attested: true });
    const [attestation] = await testDb.select().from(invoiceAttestation);
    expect(attestation).toMatchObject({ recordedByUserAccountId: actor.userAccountId, statement: ATTESTATION_STATEMENT });
    // The file stays with the sent request.
    expect(store.files.size).toBe(1);
  });

  it('lets staff hold an upload with no case or provider yet, for Intake; a submitter must choose a case', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    await caseFor(professionalId, 'CR-0001');
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const { uploadReadId } = await upload(staff, 'emailed-invoice.csv');
    const { invoiceId } = await createDraftFromUpload(testDb, staff, { uploadReadId, caseId: null, professionalId: null });
    const [draft] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(draft).toMatchObject({ caseId: null, professionalId: null });

    const read = await upload(actor, 'invoice.csv');
    await expect(
      createDraftFromUpload(testDb, actor, { uploadReadId: read.uploadReadId, caseId: null, professionalId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('starts an invoice entered by hand with no lines, which cannot be sent until it has one', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const caseId = await caseFor(professionalId, 'CR-0001');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [] });
    await expect(submitInvoice(testDb, actor, invoiceId, { attested: true })).rejects.toBeInstanceOf(ValidationError);
    await updateDraftInvoice(testDb, actor, invoiceId, { lines: [{ lineType: 'expense', amount: 25, description: 'Filing fee' }] });
    await submitInvoice(testDb, actor, invoiceId, { attested: true });
  });

  it('keeps uploads apart from case-split reads and from other users', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    await caseFor(professionalId, 'CR-0001');
    const other = await createProfessional('Someone Else');
    const { uploadReadId, store } = await upload(actor, 'invoice.csv');

    await expect(getCaseSplitRead(testDb, actor, uploadReadId)).rejects.toBeInstanceOf(CaseSplitReadNotFoundError);
    await expect(getUploadRead(testDb, other.actor, uploadReadId)).rejects.toBeInstanceOf(CaseSplitReadNotFoundError);

    await discardUploadRead(store, actor, uploadReadId);
    expect(store.files.size).toBe(0);
  });
});
