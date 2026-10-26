// model/rules.yaml match_invoice_to_case and add_professional_without_login;
// scenarios/invoice-review.md "Invoice intake".
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import { submitInvoice } from '../src/billing/invoiceLifecycle';
import { listInvoiceIntake, matchInvoiceToCase } from '../src/billing/invoiceIntake';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { invoiceExportContent, NO_CASE_WARNING } from '../src/billing/exportInvoice';
import { addProfessional } from '../src/professionals/addProfessional';
import { createKind, addKindRate } from '../src/billing/professionalRates';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { ValidationError } from '../src/errors';
import { caseAssignment, invoice, invoiceLine, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function addProvider(email?: string) {
  const { professionalKindId } = await createKind(testDb, { displayName: `Synthetic kind ${randomUUID()}` });
  await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 100, effectiveFrom: '2025-01-01' });
  return addProfessional(testDb, fixtures.staffUserAccountId, { displayName: 'Synthetic Investigator', email, professionalKindId });
}

async function openCase() {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
  });
  return caseId;
}

const items = { lines: [{ lineType: 'expense' as const, amount: 80, serviceDate: '2026-02-02', description: 'Synthetic records fee' }] };
const receipt = { receivedVia: 'email', receivedOn: '2026-02-03' };

describe('invoice intake', () => {
  it('holds an invoice with no case until staff match it, adding the provider to the case', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const provider = await addProvider();
    const { invoiceId } = await createInvoice(testDb, staff, {
      caseId: null,
      professionalId: provider.professionalId,
      submit: false,
      ...items,
      ...receipt,
    });

    expect((await listInvoiceIntake(testDb, fixtures.staffUserAccountId)).map((item) => item.invoiceId)).toEqual([invoiceId]);
    // Not submitted by accident: reviewing without a case is a choice.
    await expect(submitInvoice(testDb, staff, invoiceId, receipt)).rejects.toThrow(ValidationError);

    const caseId = await openCase();
    await expect(matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId })).rejects.toThrow(ValidationError);
    const matched = await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId, addMissing: true });
    expect(matched.addedProfessionalIds).toEqual([provider.professionalId]);

    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row?.caseId).toBe(caseId);
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    expect(lines.every((line) => line.caseId === caseId)).toBe(true);
    const assigned = await testDb
      .select()
      .from(caseAssignment)
      .where(and(eq(caseAssignment.caseId, caseId), eq(caseAssignment.professionalId, provider.professionalId), isNull(caseAssignment.endedAt)));
    expect(assigned).toHaveLength(1);
    expect(await listInvoiceIntake(testDb, fixtures.staffUserAccountId)).toEqual([]);

    await submitInvoice(testDb, staff, invoiceId, receipt);
  });

  it('holds an invoice with no professional either, chosen and priced when it is matched', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const provider = await addProvider();
    const { invoiceId } = await createInvoice(testDb, staff, {
      caseId: null,
      professionalId: null,
      submit: false,
      lines: [{ lineType: 'time', quantity: 2, serviceDate: '2026-02-02', description: 'Synthetic interview' }],
      ...receipt,
    });
    // Only as a held draft: not with a case, and not submitted.
    await expect(
      createInvoice(testDb, staff, { caseId: await openCase(), professionalId: null, submit: false, ...items }),
    ).rejects.toThrow();
    await expect(submitInvoice(testDb, staff, invoiceId, { ...receipt, withoutCase: true })).rejects.toThrow(ValidationError);

    const caseId = await openCase();
    await expect(matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId, addMissing: true })).rejects.toThrow(
      ValidationError,
    );
    await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, {
      caseId,
      addMissing: true,
      professionalId: provider.professionalId,
    });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row).toMatchObject({ professionalId: provider.professionalId, submittedTotal: '200.00' });
    await submitInvoice(testDb, staff, invoiceId, receipt);
  });

  it('lets staff review an invoice without a case, flagged everywhere', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const provider = await addProvider();
    const { invoiceId } = await createInvoice(testDb, staff, {
      caseId: null,
      professionalId: provider.professionalId,
      withoutCase: true,
      ...items,
      ...receipt,
    });

    const { invoices } = await listReviewQueue(testDb, 'open');
    expect(invoices.find((queued) => queued.invoiceId === invoiceId)?.flags.map((flag) => flag.kind)).toContain('no_case');
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    const content = invoiceExportContent(detail, { includeReviewer: true, exportedAt: new Date() });
    expect(content.summary).toContainEqual(['Case number', NO_CASE_WARNING]);
  });

  it('is for staff only, and recorded time needs a case', async () => {
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Vendor', email: 'vendor@example.com', active: true }).returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Vendor');
    const vendor = await resolvePortalActor(testDb, account!.userAccountId);
    await expect(createInvoice(testDb, vendor, { caseId: null, professionalId, ...items })).rejects.toThrow(NotAssignedToCaseError);
    await expect(listInvoiceIntake(testDb, account!.userAccountId)).rejects.toThrow();
  });

  it('gives a provider staff added their profile when they first sign in', async () => {
    const added = await addProvider('expert@example.com');
    await expect(addProvider('EXPERT@example.com')).rejects.toThrow(ValidationError);
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Expert', email: 'expert@example.com', active: true }).returning();
    expect(await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Expert')).toBe(added.professionalId);
  });
});
