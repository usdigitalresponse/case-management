// model/rules.yaml authorize_staff_invoice_entry; scenarios/invoice-review.md
// "Staff entry".
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { billableProfessionalIds, resolvePortalActor } from '../src/portal/portalActor';
import { recallInvoice, submitInvoice } from '../src/billing/invoiceLifecycle';
import { canPortalReaderReadInvoice } from '../src/billing/invoiceAccess';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { ValidationError } from '../src/errors';
import { InvoiceNotFoundError } from '../src/billing/reviewInvoiceLine';
import { caseAssignment, invoice, invoiceEvent, userAccount } from '../src/db/schema';
import { giveRate } from './rateHelpers';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createProfessional(email: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  return { userAccountId: account!.userAccountId, professionalId };
}

async function createCaseAssignedTo(professionalIds: string[]) {
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

const expense = { lines: [{ lineType: 'expense' as const, amount: 120, serviceDate: '2026-02-02' }] };

describe('staff entering an invoice received outside the system', () => {
  it('bills only professionals assigned to the case, and needs how and when it was received', async () => {
    const assigned = await createProfessional('assigned@example.com');
    const elsewhere = await createProfessional('elsewhere@example.com');
    const caseId = await createCaseAssignedTo([assigned.professionalId]);
    await createCaseAssignedTo([elsewhere.professionalId]);
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);

    expect(await billableProfessionalIds(testDb, staff, caseId)).toEqual([assigned.professionalId]);

    await expect(
      createInvoice(testDb, staff, { caseId, professionalId: assigned.professionalId, ...expense }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createInvoice(testDb, staff, { caseId, professionalId: assigned.professionalId, receivedVia: 'email', receivedOn: '2999-01-01', ...expense }),
    ).rejects.toThrow(ValidationError);

    const { invoiceId: draftId } = await createInvoice(testDb, staff, {
      caseId,
      professionalId: assigned.professionalId,
      submit: false,
      ...expense,
    });
    await submitInvoice(testDb, staff, draftId, { receivedVia: 'email', receivedOn: '2026-02-02' });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, draftId));
    expect(row?.submittedByUserAccountId).toBe(fixtures.staffUserAccountId);
    expect(row?.receivedOn).toBe('2026-02-02');
    const events = await testDb.select().from(invoiceEvent).where(eq(invoiceEvent.invoiceId, draftId));
    expect(events.every((event) => event.actorUserAccountId === fixtures.staffUserAccountId)).toBe(true);

    // It waits from the day it was received, not the day it was entered.
    const { invoices } = await listReviewQueue(testDb, 'open', { now: new Date('2026-02-09T15:00:00Z') });
    expect(invoices.find((queued) => queued.invoiceId === draftId)?.workingDaysWaiting).toBe(5);
  });

  it('shows the professional the invoice read-only', async () => {
    const assigned = await createProfessional('assigned@example.com');
    const caseId = await createCaseAssignedTo([assigned.professionalId]);
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const { invoiceId } = await createInvoice(testDb, staff, {
      caseId,
      professionalId: assigned.professionalId,
      receivedVia: 'other_tool',
      receivedOn: '2026-02-03',
      ...expense,
    });

    const professionalActor = await resolvePortalActor(testDb, assigned.userAccountId);
    expect(await canPortalReaderReadInvoice(testDb, professionalActor, invoiceId)).toBe(true);
    await expect(recallInvoice(testDb, professionalActor, invoiceId)).rejects.toThrow(InvoiceNotFoundError);
  });

  it('does not ask a professional entering their own invoice for receipt details', async () => {
    const own = await createProfessional('own@example.com');
    const caseId = await createCaseAssignedTo([own.professionalId]);
    const actor = await resolvePortalActor(testDb, own.userAccountId);
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, ...expense });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row?.receivedViaId).toBeNull();
  });
});
