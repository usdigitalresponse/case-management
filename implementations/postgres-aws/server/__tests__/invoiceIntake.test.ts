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
import { recallInvoice, submitInvoice } from '../src/billing/invoiceLifecycle';
import { listInvoiceIntake, matchInvoiceToCase, returnToSubmitter } from '../src/billing/invoiceIntake';
import { listPortalInvoices } from '../src/portal/listPortalInvoices';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { invoiceExportContent, NO_CASE_WARNING } from '../src/billing/exportInvoice';
import { addProfessional } from '../src/professionals/addProfessional';
import { editProfessional } from '../src/professionals/editProfessional';
import { createKind, addKindRate } from '../src/billing/professionalRates';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { ValidationError } from '../src/errors';
import { auditEvent, caseAssignment, invoice, invoiceAttestation, invoiceLine, userAccount } from '../src/db/schema';

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
    const { invoiceId } = await createInvoice(testDb, staff, { attested: true,
      caseId: null,
      professionalId: provider.professionalId,
      submit: false,
      ...items,
      ...receipt,
    });

    expect((await listInvoiceIntake(testDb, fixtures.staffUserAccountId)).map((item) => item.invoiceId)).toEqual([invoiceId]);
    // Sent before its case is known, it stays in intake to be matched.
    expect(await submitInvoice(testDb, staff, invoiceId, receipt)).toMatchObject({ status: 'awaiting_match' });
    expect(await listInvoiceIntake(testDb, fixtures.staffUserAccountId)).toMatchObject([{ invoiceId, stage: 'sent' }]);

    const caseId = await openCase();
    await expect(matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId })).rejects.toThrow(ValidationError);
    const matched = await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId, addMissing: true });
    expect(matched).toMatchObject({ addedProfessionalIds: [provider.professionalId], released: true });

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
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))?.invoice.statusCode).toBe('submitted');
  });

  it('holds an invoice with no professional either, chosen and priced when it is matched', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const provider = await addProvider();
    const { invoiceId } = await createInvoice(testDb, staff, { attested: true,
      caseId: null,
      professionalId: null,
      submit: false,
      lines: [{ lineType: 'time', quantity: 2, serviceDate: '2026-02-02', description: 'Synthetic interview' }],
      ...receipt,
    });
    // Even reviewed without a case, it waits for whom it bills.
    expect(await submitInvoice(testDb, staff, invoiceId, { ...receipt, withoutCase: true })).toMatchObject({ status: 'awaiting_match' });

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
  });

  it('lets staff review an invoice without a case, flagged everywhere', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const provider = await addProvider();
    const { invoiceId } = await createInvoice(testDb, staff, { attested: true,
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

  it('takes a submitter’s invoice naming a case and colleague not yet listed, and sends it on once staff match them', async () => {
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Vendor', email: 'vendor@example.com', active: true }).returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Vendor');
    const vendor = await resolvePortalActor(testDb, account!.userAccountId);
    const { invoiceId, status } = await createInvoice(testDb, vendor, {
      attested: true,
      caseId: null,
      professionalId,
      proposedCase: { clientName: 'Synthetic Client', caseNumber: 'NEW-7' },
      lines: [
        ...items.lines,
        {
          lineType: 'time',
          quantity: 2,
          serviceDate: '2026-02-02',
          description: 'Synthetic interview',
          proposedTimekeeperName: 'Synthetic Colleague',
          proposedTimekeeperEmail: 'Colleague@Example.com',
        },
      ],
    });
    expect(status).toBe('awaiting_match');
    await expect(listInvoiceIntake(testDb, account!.userAccountId)).rejects.toThrow();
    const [item] = await listInvoiceIntake(testDb, fixtures.staffUserAccountId);
    expect(item).toMatchObject({
      invoiceId,
      stage: 'sent',
      proposedCase: { clientName: 'Synthetic Client', caseNumber: 'NEW-7' },
      unlistedTimekeepers: [{ name: 'Synthetic Colleague', email: 'colleague@example.com', description: 'Synthetic interview' }],
    });

    // Matching the case alone leaves it waiting for the colleague.
    const caseId = await openCase();
    expect(await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId, addMissing: true })).toMatchObject({ released: false });
    const colleague = await addProvider();
    const matched = await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, {
      caseId,
      addMissing: true,
      timekeepers: { [item!.unlistedTimekeepers[0]!.invoiceLineId]: colleague.professionalId },
    });
    expect(matched).toMatchObject({ released: true, addedProfessionalIds: [colleague.professionalId] });

    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ statusCode: 'submitted', proposedCase: { clientName: 'Synthetic Client', caseNumber: 'NEW-7' } });
    expect(detail.lines.map((line) => line.proposedTimekeeperName)).toContain('Synthetic Colleague');
    // The attestation is the one given on sending.
    expect(await testDb.select().from(invoiceAttestation)).toHaveLength(1);
  });

  it('keeps a match that can’t go to review yet, saying why', async () => {
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Vendor', email: 'vendor@example.com', active: true }).returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Vendor');
    const vendor = await resolvePortalActor(testDb, account!.userAccountId);
    const { invoiceId } = await createInvoice(testDb, vendor, {
      attested: true,
      caseId: null,
      professionalId,
      lines: [{ lineType: 'time', description: 'Synthetic interview', proposedTimekeeperName: 'Synthetic Colleague' }],
    });
    const [item] = await listInvoiceIntake(testDb, fixtures.staffUserAccountId);
    const colleague = await addProvider();
    const caseId = await openCase();
    const matched = await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, {
      caseId,
      addMissing: true,
      timekeepers: { [item!.unlistedTimekeepers[0]!.invoiceLineId]: colleague.professionalId },
    });
    expect(matched).toMatchObject({ released: false, releaseProblem: expect.stringContaining('needs a date and hours') });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))?.invoice).toMatchObject({ caseId, statusCode: 'awaiting_match' });
  });

  it('lets staff send a waiting invoice back with a reason the submitter sees until they send it again', async () => {
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Vendor', email: 'vendor@example.com', active: true }).returning();
    await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Vendor');
    const vendor = await resolvePortalActor(testDb, account!.userAccountId);
    const { invoiceId } = await createInvoice(testDb, vendor, { attested: true, caseId: null, ...items });

    await expect(returnToSubmitter(testDb, fixtures.staffUserAccountId, invoiceId, { reason: ' ' })).rejects.toThrow(ValidationError);
    await expect(returnToSubmitter(testDb, account!.userAccountId, invoiceId, { reason: 'Add the case number.' })).rejects.toThrow();
    await returnToSubmitter(testDb, fixtures.staffUserAccountId, invoiceId, { reason: 'Add the case number.' });

    const [listed] = await listPortalInvoices(testDb, vendor);
    expect(listed).toMatchObject({ invoiceId, statusCode: 'draft', returnedReason: 'Add the case number.' });
    // Theirs again, so off Intake, and it can't be sent back twice.
    expect(await listInvoiceIntake(testDb, fixtures.staffUserAccountId)).toEqual([]);
    await expect(returnToSubmitter(testDb, fixtures.staffUserAccountId, invoiceId, { reason: 'Again' })).rejects.toThrow(ValidationError);

    expect(await submitInvoice(testDb, vendor, invoiceId, { attested: true })).toMatchObject({ status: 'awaiting_match' });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'submitter'))?.invoice.returnedReason).toBeNull();
  });

  it('lets a submitter recall an invoice waiting to be matched', async () => {
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Vendor', email: 'vendor@example.com', active: true }).returning();
    await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Vendor');
    const vendor = await resolvePortalActor(testDb, account!.userAccountId);
    const { invoiceId } = await createInvoice(testDb, vendor, { attested: true, caseId: null, ...items });
    await recallInvoice(testDb, vendor, invoiceId);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))?.invoice.statusCode).toBe('draft');
  });

  it('lets an email be added to a provider later, who then gets their profile on first sign-in', async () => {
    const added = await addProvider();
    await addProvider('taken@example.com');
    const actor = fixtures.staffUserAccountId;
    await expect(editProfessional(testDb, actor, added.professionalId, { displayName: 'Synthetic Investigator', email: 'TAKEN@example.com' })).rejects.toThrow(
      ValidationError,
    );
    await editProfessional(testDb, actor, added.professionalId, { displayName: 'Synthetic Investigator Jr', email: 'Later@Example.com' });
    const [change] = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'professional_changed'));
    expect(change).toMatchObject({ entityId: added.professionalId, priorValues: { displayName: 'Synthetic Investigator', email: null } });

    const [account] = await testDb.insert(userAccount).values({ displayName: 'Later', email: 'later@example.com', active: true }).returning();
    expect(await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Later')).toBe(added.professionalId);
    // Now they sign in with it, so it stays; their name can still be corrected.
    await expect(editProfessional(testDb, actor, added.professionalId, { displayName: 'Synthetic Investigator', email: 'other@example.com' })).rejects.toThrow(
      ValidationError,
    );
    await editProfessional(testDb, actor, added.professionalId, { displayName: 'Synthetic Investigator', email: 'later@example.com' });
  });

  it('gives a provider staff added their profile when they first sign in', async () => {
    const added = await addProvider('expert@example.com');
    await expect(addProvider('EXPERT@example.com')).rejects.toThrow(ValidationError);
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Expert', email: 'expert@example.com', active: true }).returning();
    expect(await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Expert')).toBe(added.professionalId);
  });
});
