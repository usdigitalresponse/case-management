import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor } from '../src/portal/portalActor';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import { previewCaseSplit, uploadInvoiceFileByCase } from '../src/imports/splitByCase';
import { confirmInvoiceImport, listInvoiceImports } from '../src/imports/invoiceImports';
import type { DocumentStore } from '../src/imports/documentStore';
import { ValidationError } from '../src/errors';
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

describe('splitting a file for one professional by case', () => {
  it('suggests each line its case, then makes one draft per case sharing the file', async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const first = await caseFor(professionalId, 'CR-0001');
    const second = await caseFor(professionalId, 'CR-0002');
    const bytes = Buffer.from(CSV);

    const preview = await previewCaseSplit(testDb, actor, { professionalId, bytes });
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

    const store = memoryStore();
    const upload = (caseIds: string[]) =>
      uploadInvoiceFileByCase(testDb, store, actor, {
        professionalId,
        fileName: 'firm-export.csv',
        fileBase64: bytes.toString('base64'),
        caseIds,
      });
    await expect(upload([first, first, second])).rejects.toThrow(ValidationError);

    const { imports } = await upload([first, first, second, second]);
    expect(imports.map((row) => row.caseId)).toEqual([first, second]);
    const rows = await testDb.select().from(invoiceImport);
    expect(new Set(rows.map((row) => row.documentId)).size).toBe(1);
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

    // The file stays until the last part is resolved.
    await confirmInvoiceImport(testDb, store, actor, imports[0]!.invoiceImportId);
    expect(store.files.size).toBe(1);
    const [kept] = await testDb.select().from(document);
    expect(kept?.contentDeletedAt).toBeNull();
    await confirmInvoiceImport(testDb, store, actor, imports[1]!.invoiceImportId);
    expect(store.files.size).toBe(0);
  });

  it("refuses cases outside the professional's and people the user can't bill for", async () => {
    const { actor, professionalId } = await createProfessional('Synthetic Attorney');
    const other = await createProfessional('Other Attorney');
    const own = await caseFor(professionalId, 'CR-0001');
    const theirs = await caseFor(other.professionalId, 'CR-0009');
    const fileBase64 = Buffer.from(CSV).toString('base64');

    await expect(
      uploadInvoiceFileByCase(testDb, memoryStore(), actor, { professionalId, fileBase64, caseIds: [own, own, own, theirs] }),
    ).rejects.toThrow(NotAssignedToCaseError);
    await expect(previewCaseSplit(testDb, actor, { professionalId: other.professionalId, bytes: Buffer.from(CSV) })).rejects.toThrow(
      NotAssignedToCaseError,
    );
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
    await expect(
      uploadInvoiceFileByCase(testDb, memoryStore(), actor, { professionalId, fileBase64: tooBig, caseIds: [own] }),
    ).rejects.toThrow(ValidationError);
  });
});
