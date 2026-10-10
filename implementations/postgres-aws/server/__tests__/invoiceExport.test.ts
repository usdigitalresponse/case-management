import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { canPortalReaderReadInvoice, isExportableStatus, portalReadableInvoiceCondition } from '../src/billing/invoiceAccess';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { invoiceExportContent, renderInvoicePdf, renderInvoiceXlsx } from '../src/billing/exportInvoice';
import { caseAssignment, invoice, invoiceLine, invoiceStatuses, userAccount } from '../src/db/schema';
import { getReferenceId } from '../src/db/referenceLookups';
import { DRAFT_INVOICE_STATUS_CODE } from '../src/billing/invoiceStatusCodes';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createProfessional(email: string): Promise<{ userAccountId: string; professionalId: string }> {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  return { userAccountId: account.userAccountId, professionalId };
}

async function createAssignedCase(professionalIds: string[]): Promise<string> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
  });
  for (const professionalId of professionalIds) {
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date('2026-01-15T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
  }
  return caseId;
}

describe('portal invoice access', () => {
  it('lets the submitter and a matched timekeeper read an invoice, and no one else', async () => {
    const submitter = await createProfessional('submitter@example.com');
    const colleague = await createProfessional('colleague@example.com');
    const outsider = await createProfessional('outsider@example.com');
    const caseId = await createAssignedCase([submitter.professionalId, colleague.professionalId]);
    const { invoiceId } = await createInvoice(testDb, submitter, { caseId, lines: [{ amount: 100 }, { amount: 50 }] });
    const [, colleagueLine] = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    await testDb
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: colleague.professionalId })
      .where(eq(invoiceLine.invoiceLineId, colleagueLine!.invoiceLineId));

    expect(await canPortalReaderReadInvoice(testDb, submitter, invoiceId)).toBe(true);
    expect(await canPortalReaderReadInvoice(testDb, colleague, invoiceId)).toBe(true);
    expect(await canPortalReaderReadInvoice(testDb, outsider, invoiceId)).toBe(false);

    const listed = await testDb
      .select({ invoiceId: invoice.invoiceId })
      .from(invoice)
      .where(portalReadableInvoiceCondition(testDb, colleague));
    expect(listed.map((row) => row.invoiceId)).toEqual([invoiceId]);
  });

  it('lets a submitter without a professional profile read what they submitted', async () => {
    const professionalUser = await createProfessional('represented@example.com');
    const caseId = await createAssignedCase([professionalUser.professionalId]);
    const { invoiceId } = await createInvoice(testDb, professionalUser, { caseId, lines: [{ amount: 10 }] });
    const [delegate] = await testDb
      .insert(userAccount)
      .values({ displayName: 'Delegate', email: 'delegate@example.com', active: true })
      .returning();
    await testDb.update(invoice).set({ submittedByUserAccountId: delegate!.userAccountId }).where(eq(invoice.invoiceId, invoiceId));

    expect(
      await canPortalReaderReadInvoice(testDb, { userAccountId: delegate!.userAccountId, professionalId: undefined }, invoiceId),
    ).toBe(true);
    expect(await canPortalReaderReadInvoice(testDb, professionalUser, invoiceId)).toBe(true);
  });

  it('does not export drafts', async () => {
    const submitter = await createProfessional('drafter@example.com');
    const caseId = await createAssignedCase([submitter.professionalId]);
    const { invoiceId } = await createInvoice(testDb, submitter, { caseId, lines: [{ amount: 10 }] });
    const exportable = async () => isExportableStatus((await loadInvoiceDetail(testDb, invoiceId))!.invoice.statusCode);
    expect(await exportable()).toBe(true);

    const draftStatusId = await getReferenceId(testDb, invoiceStatuses, DRAFT_INVOICE_STATUS_CODE);
    await testDb.update(invoice).set({ statusId: draftStatusId }).where(eq(invoice.invoiceId, invoiceId));
    expect(await exportable()).toBe(false);
  });
});

describe('invoice export', () => {
  async function exportFixture() {
    const submitter = await createProfessional('exporter@example.com');
    const caseId = await createAssignedCase([submitter.professionalId]);
    const { invoiceId } = await createInvoice(testDb, submitter, {
      caseId,
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      lines: [
        { amount: 150, serviceDate: '2026-02-03', description: 'Synthetic research', quantity: 1.5, unitRate: 100, taskCode: 'SAMPLE-TASK' },
        { amount: 25 },
      ],
    });
    const detail = await loadInvoiceDetail(testDb, invoiceId);
    if (!detail) {
      throw new Error('Expected invoice detail.');
    }
    return detail;
  }

  it('renders the same rows for both formats, hiding reviewers from external users', async () => {
    const detail = await exportFixture();
    const exportedAt = new Date('2026-03-01T12:00:00Z');
    const internal = invoiceExportContent(detail, { includeReviewer: true, exportedAt });
    const external = invoiceExportContent(detail, { includeReviewer: false, exportedAt });

    expect(internal.columns).toContain('Reviewed by');
    expect(external.columns).not.toContain('Reviewed by');
    expect(external.summary).toContainEqual(['Requested total', '175.00']);
    expect(external.summary).toContainEqual(['Approved total', '0.00']);
    expect(external.summary).toContainEqual(['Exported', '2026-03-01 12:00:00 UTC']);
    expect(external.rows).toContainEqual([
      '2026-02-03', 'Other', 'Synthetic research', '', 'SAMPLE-TASK', 1.5, 100, 150, 'Not reviewed', null, '',
    ]);
    expect(external.summary).toContainEqual(['Submitted by', 'exporter@example.com']);
  });

  it('produces a PDF and an XLSX file', async () => {
    const detail = await exportFixture();
    const options = { includeReviewer: false, exportedAt: new Date() };
    const pdf = await renderInvoicePdf(detail, options);
    const xlsx = await renderInvoiceXlsx(detail, options);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  });
});
