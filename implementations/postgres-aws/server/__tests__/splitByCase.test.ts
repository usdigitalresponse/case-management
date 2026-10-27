import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  discardCaseSplitRead,
  expireCaseSplitReads,
  getCaseSplitRead,
  SPLIT_READ_EXPIRY_MS,
  startCaseSplitRead,
  uploadInvoiceFileByCase,
} from '../src/imports/splitByCase';
import { confirmInvoiceImport, listInvoiceImports } from '../src/imports/invoiceImports';
import { withdrawInvoice } from '../src/billing/invoiceLifecycle';
import { extractionsSettled } from '../src/imports/extractionJobs';
import { UnsupportedInvoiceFileError } from '../src/imports/detectFormat';
import type { DocumentStore } from '../src/imports/documentStore';
import { ValidationError } from '../src/errors';
import { addMileageRate } from '../src/billing/mileageRates';
import { caseAssignment, caseTable, document, invoiceImport, invoiceLine, userAccount } from '../src/db/schema';

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

const CSV = [
  'case,date,type,description,hours,amount',
  'CR-0001,2026-01-10,time,Research,1.5,150',
  'cr 0001,2026-01-11,time,Drafting,1,100',
  'CR-0002,2026-01-12,expense,Filing fee,,40',
  'Unknown matter,2026-01-13,time,Call,0.5,50',
  '',
].join('\n');

// Starts the background read and waits for it, as the bulk import page polls.
async function readForSplit(actor: PortalActor, professionalId: string, bytes: Buffer, store = memoryStore()) {
  const { splitReadId } = await startCaseSplitRead(testDb, store, actor, { professionalId, fileName: 'firm-export.csv', bytes });
  await extractionsSettled();
  return { splitReadId, store, read: await getCaseSplitRead(testDb, actor, splitReadId) };
}

function previewOf(read: Awaited<ReturnType<typeof getCaseSplitRead>>) {
  if (read.status !== 'ready') {
    throw new Error(`Expected a finished read, got ${read.status}`);
  }
  return read.preview;
}

describe('splitting a file for one professional by case', () => {
  it('previews mileage at the mileage rate, as its draft will bill it', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Investigator');
    await caseFor(professionalId, 'CR-0001');
    await addMileageRate(testDb, fixtures.staffUserAccountId, { ratePerMile: 0.5, effectiveFrom: '2025-01-01' });
    const bytes = Buffer.from(
      ['case,date,type,description,hours,amount', 'CR-0001,2026-01-10,expense,Mileage to interview (20 miles),,12', ''].join('\n'),
    );
    const preview = previewOf((await readForSplit(actor, professionalId, bytes)).read);
    expect(preview.lines[0]).toMatchObject({ lineType: 'mileage', quantity: 20, amount: 12, billedRate: '0.500', billedAmount: 10 });
  });

  it('suggests each line its case, then makes one draft per case from the stored reading and file', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const first = await caseFor(professionalId, 'CR-0001');
    const second = await caseFor(professionalId, 'CR-0002');

    const { splitReadId, store, read } = await readForSplit(actor, professionalId, Buffer.from(CSV));
    const preview = previewOf(read);
    expect(preview.cases.map((row) => row.caseId).sort()).toEqual([first, second].sort());
    expect(preview.lines.map((line) => line.suggestedCaseId)).toEqual([first, first, second, null]);
    expect(preview.lines[3]).toMatchObject({ caseLabel: 'Unknown matter', description: 'Call' });
    // Billed at the professional's rate ($100/h), beside what the file says.
    expect(preview.lines.map((line) => [line.amount, line.billedRate, line.billedAmount])).toEqual([
      [150, '100.00', 150],
      [100, '100.00', 100],
      [40, null, 40],
      [50, '100.00', 50],
    ]);

    const upload = (caseIds: string[]) => uploadInvoiceFileByCase(testDb, actor, { splitReadId, caseIds });
    await expect(upload([first, first, second])).rejects.toThrow(ValidationError);

    const { imports } = await upload([first, first, second, second]);
    expect(imports.map((row) => row.caseId)).toEqual([first, second]);
    // Used up: the drafts can't be made twice.
    await expect(upload([first, first, second, second])).rejects.toThrow(CaseSplitReadNotFoundError);
    const rows = await testDb.select().from(invoiceImport);
    expect(new Set(rows.map((row) => row.documentId)).size).toBe(1);
    const [stored] = await testDb.select().from(document);
    expect(stored?.displayName).toBe('firm-export.csv');
    const firstLines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, imports[0]!.invoiceId));
    expect(firstLines.map((line) => line.description).sort()).toEqual(['Drafting', 'Research']);
    expect(firstLines.every((line) => line.timekeeperProfessionalId === professionalId)).toBe(true);
    // Recorded as set, not suggested, and held to on confirmation.
    expect((rows[0]?.extractionResult as { designated_professional_id?: string }).designated_professional_id).toBe(professionalId);
    const other = await createProfessional('Other Attorney');
    await testDb
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: other.professionalId })
      .where(eq(invoiceLine.invoiceId, imports[0]!.invoiceId));
    await expect(confirmInvoiceImport(testDb, store, actor, imports[0]!.invoiceImportId)).rejects.toThrow(ValidationError);
    await testDb
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: professionalId })
      .where(eq(invoiceLine.invoiceId, imports[0]!.invoiceId));
    expect((await listInvoiceImports(testDb, actor)).map((row) => row.caseId)).toEqual([first, second]);
    // Neither part warns that the other is a duplicate.
    expect((await listInvoiceImports(testDb, actor)).every((row) => row.warningCount === 0)).toBe(true);

    // The file stays with the confirmed requests; withdrawing one keeps it
    // for the other, and withdrawing both releases it.
    await confirmInvoiceImport(testDb, store, actor, imports[0]!.invoiceImportId);
    await confirmInvoiceImport(testDb, store, actor, imports[1]!.invoiceImportId);
    expect(store.files.size).toBe(1);
    await withdrawInvoice(testDb, actor, imports[0]!.invoiceId);
    const [kept] = await testDb.select().from(document);
    expect(kept?.contentDeletedAt).toBeNull();
    await withdrawInvoice(testDb, actor, imports[1]!.invoiceId);
    const [released] = await testDb.select().from(document);
    expect(released?.contentDeletedAt).not.toBeNull();
  });

  it('reads a PDF in the background queue, reporting progress until it is done', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    await caseFor(professionalId, 'CR-0001');
    const bytes = readFileSync(join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices', 'pdf-itemized.pdf'));
    const store = memoryStore();
    const { splitReadId } = await startCaseSplitRead(testDb, store, actor, { professionalId, bytes });
    expect((await getCaseSplitRead(testDb, actor, splitReadId)).status).toBe('reading');
    await extractionsSettled();
    expect(previewOf(await getCaseSplitRead(testDb, actor, splitReadId)).lines).toHaveLength(6);
  });

  it('says why a file couldn’t be read', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const bytes = Buffer.from(['case,date,type,description,hours,amount', 'CR-0001,10/01/2026,time,Research,1.5,150', ''].join('\n'));
    const { read } = await readForSplit(actor, professionalId, bytes);
    expect(read).toMatchObject({ status: 'failed', failureMessage: expect.stringContaining('YYYY-MM-DD') });
  });

  it("refuses cases outside the professional's, people the user can't bill for, and others' reads", async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const other = await createProfessional('Other Attorney');
    const own = await caseFor(professionalId, 'CR-0001');
    const theirs = await caseFor(other.professionalId, 'CR-0009');
    const { splitReadId } = await readForSplit(actor, professionalId, Buffer.from(CSV));

    await expect(uploadInvoiceFileByCase(testDb, actor, { splitReadId, caseIds: [own, own, own, theirs] })).rejects.toThrow(
      NotAssignedToCaseError,
    );
    await expect(
      startCaseSplitRead(testDb, memoryStore(), actor, { professionalId: other.professionalId, bytes: Buffer.from(CSV) }),
    ).rejects.toThrow(NotAssignedToCaseError);
    await expect(
      startCaseSplitRead(testDb, memoryStore(), actor, { professionalId, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).rejects.toThrow(UnsupportedInvoiceFileError);
    await expect(getCaseSplitRead(testDb, other.actor, splitReadId)).rejects.toThrow(CaseSplitReadNotFoundError);
  });

  it('deletes the file when a read is discarded or left unused for an hour', async () => {
    // Reads earlier tests left pending, which live for the whole process.
    await expireCaseSplitReads(memoryStore(), new Date(Date.now() + 2 * SPLIT_READ_EXPIRY_MS));
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const discarded = await readForSplit(actor, professionalId, Buffer.from(CSV));
    await discardCaseSplitRead(discarded.store, actor, discarded.splitReadId);
    expect(discarded.store.files.size).toBe(0);
    await expect(getCaseSplitRead(testDb, actor, discarded.splitReadId)).rejects.toThrow(CaseSplitReadNotFoundError);

    const unused = await readForSplit(actor, professionalId, Buffer.from(CSV));
    expect(await expireCaseSplitReads(unused.store, new Date(Date.now() + SPLIT_READ_EXPIRY_MS / 2))).toBe(0);
    expect(await expireCaseSplitReads(unused.store, new Date(Date.now() + SPLIT_READ_EXPIRY_MS + 1000))).toBe(1);
    expect(unused.store.files.size).toBe(0);
  });
});
