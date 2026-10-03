import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import {
  reviewInvoiceLine,
  InvoiceLineAlreadyReviewedError,
  InvoiceLineNotFoundError,
  InvoiceNotFoundError,
  InvoiceNotSubmittedError,
} from '../src/billing/reviewInvoiceLine';
import { ValidationError } from '../src/errors';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { invoice, invoiceApprovalChain, invoiceApprovalDecision, invoiceLine, userAccount } from '../src/db/schema';

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

async function createInvoiceWithLines(
  amounts: string[],
  statusId = fixtures.invoiceStatusSubmittedId,
): Promise<{ invoiceId: string; lineIds: string[] }> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
  const { userAccountId, professionalId } = await createProfessional();
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: userAccountId,
      professionalId,
      statusId,
      submittedAt: new Date(),
      submittedTotal: amounts.reduce((sum, amount) => sum + Number(amount), 0).toFixed(2),
      caseId,
    })
    .returning();
  if (!row) {
    throw new Error('Expected insert to return a row.');
  }
  const lines = await testDb
    .insert(invoiceLine)
    .values(amounts.map((amount) => ({ invoiceId: row.invoiceId, caseId, lineTypeId: fixtures.invoiceLineTypeSampleId, amount })))
    .returning();
  return { invoiceId: row.invoiceId, lineIds: lines.map((line) => line.invoiceLineId) };
}

async function invoiceStatusId(invoiceId: string): Promise<string | undefined> {
  const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  return row?.statusId;
}

async function decisionsFor(invoiceId: string) {
  return testDb
    .select({ decision: invoiceApprovalDecision })
    .from(invoiceApprovalDecision)
    .innerJoin(invoiceApprovalChain, eq(invoiceApprovalDecision.invoiceApprovalChainId, invoiceApprovalChain.invoiceApprovalChainId))
    .where(eq(invoiceApprovalChain.invoiceId, invoiceId))
    .then((rows) => rows.map((row) => row.decision));
}

describe('reviewInvoiceLine', () => {
  it('records a line decision at the requested amount and leaves the invoice submitted until every line is decided', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    const result = await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' });

    expect(result.statusId).toBe(fixtures.invoiceStatusSubmittedId);
    expect(await invoiceStatusId(invoiceId)).toBe(fixtures.invoiceStatusSubmittedId);
    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(chain?.createdByUserAccountId).toBe(fixtures.staffUserAccountId);
    const decisions = await decisionsFor(invoiceId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      sequenceNumber: 1,
      invoiceLineId: lineIds[0],
      outcomeId: fixtures.invoiceApprovalOutcomeApprovedId,
      stepTypeId: fixtures.invoiceApprovalStepTypeLineReviewId,
      approvedAmount: '70.00',
      decidedByUserAccountId: fixtures.staffUserAccountId,
    });
  });

  it('approves the invoice once every line is approved, keeping partial approved amounts per line', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved', approvedAmount: 60 });
    const result = await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[1]!, {
      outcome: 'approved',
      approvedAmount: '40.00',
    });

    expect(result.statusId).toBe(fixtures.invoiceStatusApprovedId);
    expect(await invoiceStatusId(invoiceId)).toBe(fixtures.invoiceStatusApprovedId);
    const chains = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(chains).toHaveLength(1);
    const approved = (await decisionsFor(invoiceId)).map((d) => d.approvedAmount).sort();
    expect(approved).toEqual(['40.00', '60.00']);
    const [submitted] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(submitted?.submittedTotal).toBe('120.00');
  });

  it('rejects the invoice once every line is decided and any line was rejected', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    const afterReject = await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, {
      outcome: 'rejected',
      reason: 'Not supported by the attached time entries.',
    });
    expect(afterReject.statusId).toBe(fixtures.invoiceStatusSubmittedId);

    const result = await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[1]!, { outcome: 'approved' });

    expect(result.statusId).toBe(fixtures.invoiceStatusRejectedId);
    const rejected = (await decisionsFor(invoiceId)).find((d) => d.invoiceLineId === lineIds[0]);
    expect(rejected?.reason).toBe('Not supported by the attached time entries.');
    expect(rejected?.approvedAmount).toBeNull();
  });

  it('requires a reason to reject a line', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'rejected' }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an approved amount on a rejected line', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, {
        outcome: 'rejected',
        reason: 'Duplicate.',
        approvedAmount: 10,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects approving more than the line requested, or a non-positive amount', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);

    for (const approvedAmount of [70.01, 0, -5, 0.001]) {
      await expect(
        reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved', approvedAmount }),
      ).rejects.toThrow(ValidationError);
    }
    expect(await decisionsFor(invoiceId)).toHaveLength(0);
  });

  it('rejects a second decision on the same line', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' });

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'rejected', reason: 'Changed mind.' }),
    ).rejects.toThrow(InvoiceLineAlreadyReviewedError);
  });

  it('rejects reviewing an invoice that is no longer submitted', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' });

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotSubmittedError);
  });

  it('rejects reviewing a draft invoice (not yet submitted)', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00'], fixtures.invoiceStatusDraftId);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotSubmittedError);
  });

  it('rejects a line that belongs to a different invoice', async () => {
    const first = await createInvoiceWithLines(['70.00']);
    const second = await createInvoiceWithLines(['50.00']);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, first.invoiceId, second.lineIds[0]!, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceLineNotFoundError);
  });

  it('rejects an unknown or malformed invoice or line id', async () => {
    const { invoiceId } = await createInvoiceWithLines(['70.00']);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, randomUUID(), randomUUID(), { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotFoundError);
    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, 'not-a-uuid', randomUUID(), { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceNotFoundError);
    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, 'not-a-uuid', { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceLineNotFoundError);
  });

  it('rejects an invalid outcome value', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);

    await expect(
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'maybe' }),
    ).rejects.toThrow(ValidationError);
  });

  it('shares one chain between concurrent reviews of different lines and completes the invoice', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    await Promise.all(
      lineIds.map((lineId) => reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineId, { outcome: 'approved' })),
    );

    const chains = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(chains).toHaveLength(1);
    expect(await decisionsFor(invoiceId)).toHaveLength(2);
    expect(await invoiceStatusId(invoiceId)).toBe(fixtures.invoiceStatusApprovedId);
  });

  it('lets exactly one of two concurrent reviews of the same line decide it', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    const results = await Promise.allSettled([
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' }),
      reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'rejected', reason: 'Duplicate.' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(InvoiceLineAlreadyReviewedError);
    expect(await decisionsFor(invoiceId)).toHaveLength(1);
  });
});
