import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import {
  reviewInvoice,
  ReviewInvoiceValidationError,
  InvoiceNotFoundError,
  InvoiceNotSubmittedError,
} from '../src/billing/reviewInvoice';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { invoice, invoiceApprovalChain, invoiceApprovalDecision, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

function baseCaseInput(overrides: Partial<CreateCaseInput> = {}): CreateCaseInput {
  return {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

async function createProfessional(): Promise<{ userAccountId: string; professionalId: string }> {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  return { userAccountId: account.userAccountId, professionalId };
}

async function createSubmittedInvoice(caseId: string): Promise<string> {
  const { userAccountId, professionalId } = await createProfessional();
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: userAccountId,
      professionalId,
      statusId: fixtures.invoiceStatusSubmittedId,
      submittedAt: new Date(),
      submittedTotal: '100.00',
      caseId,
    })
    .returning();
  if (!row) {
    throw new Error('Expected insert to return a row.');
  }
  return row.invoiceId;
}

describe('reviewInvoice', () => {
  it('approves a submitted invoice, recording a chain and a decision', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);

    const result = await reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'approved' });

    expect(result.statusId).toBe(fixtures.invoiceStatusApprovedId);
    const [invoiceRow] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(invoiceRow?.statusId).toBe(fixtures.invoiceStatusApprovedId);

    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(chain?.createdByUserAccountId).toBe(fixtures.staffUserAccountId);
    const decisions = await testDb
      .select()
      .from(invoiceApprovalDecision)
      .where(eq(invoiceApprovalDecision.invoiceApprovalChainId, chain!.invoiceApprovalChainId));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.sequenceNumber).toBe(1);
    expect(decisions[0]?.invoiceLineId).toBeNull();
  });

  it('rejects a submitted invoice when given a reason', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);

    const result = await reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, {
      outcome: 'rejected',
      reason: 'Amounts do not match the attached time entries.',
    });

    expect(result.statusId).toBe(fixtures.invoiceStatusRejectedId);
    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    const [decision] = await testDb
      .select()
      .from(invoiceApprovalDecision)
      .where(eq(invoiceApprovalDecision.invoiceApprovalChainId, chain!.invoiceApprovalChainId));
    expect(decision?.reason).toBe('Amounts do not match the attached time entries.');
  });

  it('requires a reason to reject', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);

    await expect(
      reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'rejected' }),
    ).rejects.toThrow(ReviewInvoiceValidationError);
  });

  it('rejects an unknown invoice', async () => {
    await expect(
      reviewInvoice(testDb, fixtures.staffUserAccountId, '00000000-0000-0000-0000-000000000000', { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotFoundError);
  });

  it('rejects reviewing a draft invoice (not yet submitted)', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const { userAccountId, professionalId } = await createProfessional();
    const [draftInvoice] = await testDb
      .insert(invoice)
      .values({
        submittedByUserAccountId: userAccountId,
        professionalId,
        statusId: fixtures.invoiceStatusDraftId,
        submittedTotal: '0.00',
        caseId,
      })
      .returning();

    await expect(
      reviewInvoice(testDb, fixtures.staffUserAccountId, draftInvoice!.invoiceId, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotSubmittedError);
  });

  it('rejects reviewing an already-approved invoice a second time', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);
    await reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'approved' });

    await expect(
      reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotSubmittedError);
  });

  it('lets exactly one of two concurrent reviews decide the invoice', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);

    const results = await Promise.allSettled([
      reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'approved' }),
      reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'rejected', reason: 'Duplicate.' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(InvoiceNotSubmittedError);
    const chains = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(chains).toHaveLength(1);
  });

  it('rejects an invalid outcome value', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await createSubmittedInvoice(caseId);

    await expect(
      reviewInvoice(testDb, fixtures.staffUserAccountId, invoiceId, { outcome: 'maybe' }),
    ).rejects.toThrow(ReviewInvoiceValidationError);
  });
});
