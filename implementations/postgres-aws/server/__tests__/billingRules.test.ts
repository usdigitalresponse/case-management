import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { submitInvoice } from '../src/billing/invoiceLifecycle';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import {
  addBillingCode,
  getBillingRules,
  setBillingCodeActive,
  setBillingRule,
} from '../src/billing/billingRules';
import { ValidationError } from '../src/errors';
import { caseAssignment, invoiceApprovalChain, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function setup(): Promise<{ actor: PortalActor; caseId: string }> {
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: 'Synthetic Attorney', email: `${randomUUID()}@example.com`, active: true })
    .returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Synthetic Attorney');
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
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
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), caseId };
}

const set = (code: string, enforcement: string, parameters: Record<string, unknown> = {}) =>
  setBillingRule(testDb, fixtures.staffUserAccountId, code, { enforcement, parameters });

const refused = (pattern: RegExp) => expect.objectContaining({ fieldErrors: { lines: expect.stringMatching(pattern) } });

const time = (hours: number, extra: Record<string, unknown> = {}) => ({
  lineType: 'time' as const,
  serviceDate: '2026-02-02',
  quantity: hours,
  description: `Work ${hours}`,
  ...extra,
});

describe('billing rule settings', () => {
  it('start off, keep their history, and validate what an administrator sets', async () => {
    expect((await getBillingRules(testDb)).every((rule) => rule.enforcement === 'off')).toBe(true);
    await set('time_increment', 'warn', { increment: 0.25 });
    await set('time_increment', 'require', { increment: 0.1 });
    expect((await getBillingRules(testDb)).find((rule) => rule.code === 'time_increment')).toMatchObject({
      enforcement: 'require',
      parameters: { increment: 0.1 },
    });
    await expect(set('long_entry', 'require')).rejects.toThrow(ValidationError);
    await expect(set('daily_hour_cap', 'warn', { hours: 0 })).rejects.toThrow(ValidationError);
    await expect(set('no_such_rule', 'warn')).rejects.toThrow(/not found/);
  });
});

describe('applying billing rules', () => {
  it('requires codes from the list, blocking submission until they are', async () => {
    const { actor, caseId } = await setup();
    const { billingCodeId } = await addBillingCode(testDb, { code: 'l110', displayName: 'Fact investigation' });
    await set('billing_codes', 'require');

    const draft = await createInvoice(testDb, actor, { caseId, submit: false, lines: [time(1)] });
    await expect(submitInvoice(testDb, actor, draft.invoiceId)).rejects.toThrow(
      expect.objectContaining({ fieldErrors: { lines: `"Work 1" needs a task code from the agency's list.` } }),
    );
    // Codes match whatever case they were written in, and are kept in upper case.
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [time(1, { taskCode: 'l110' })] });
    expect((await loadInvoiceDetail(testDb, invoiceId))!.lines[0]?.taskCode).toBe('L110');

    await setBillingCodeActive(testDb, billingCodeId, { active: false });
    await expect(createInvoice(testDb, actor, { caseId, lines: [time(1, { taskCode: 'L110' })] })).rejects.toThrow(
      refused(/L110, which isn't on the agency's list/),
    );
  });

  it('shows warnings on a draft and keeps them, with the settings, in the snapshot', async () => {
    const { actor, caseId } = await setup();
    await set('time_increment', 'warn', { increment: 0.1 });
    await set('long_entry', 'warn', { hours: 6 });
    await set('billing_period', 'warn', { withinMonth: true });

    const { invoiceId } = await createInvoice(testDb, actor, {
      caseId,
      submit: false,
      periodStart: '2026-01-15',
      periodEnd: '2026-02-14',
      lines: [time(1.33), time(7)],
    });
    const draft = await loadInvoiceDetail(testDb, invoiceId);
    expect(draft!.ruleFindings.map((finding) => finding.rule).sort()).toEqual(['billing_period', 'long_entry', 'time_increment']);
    expect(draft!.ruleFindings.find((finding) => finding.rule === 'time_increment')?.message).toBe(
      `"Work 1.33": 1.33 h isn't a whole multiple of 0.1 h.`,
    );

    await submitInvoice(testDb, actor, invoiceId);
    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    const snapshot = chain!.submissionSnapshot as { billing_rules: { settings: Array<{ code: string }>; findings: unknown[] } };
    expect(snapshot.billing_rules.settings.map((rule) => rule.code).sort()).toEqual(['billing_period', 'long_entry', 'time_increment']);
    expect(snapshot.billing_rules.findings).toHaveLength(3);

    // A later change to the rules doesn't alter what was submitted.
    await set('time_increment', 'off');
    expect((await loadInvoiceDetail(testDb, invoiceId))!.ruleFindings).toHaveLength(3);
  });

  it("caps one person's hours on a day across submitted invoices, not other drafts", async () => {
    const { actor, caseId } = await setup();
    await set('daily_hour_cap', 'require', { hours: 8 });
    await createInvoice(testDb, actor, { caseId, submit: false, lines: [time(6)] });
    await createInvoice(testDb, actor, { caseId, lines: [time(5)] });
    await expect(createInvoice(testDb, actor, { caseId, lines: [time(4)] })).rejects.toThrow(
      refused(/Synthetic Attorney has 9 h billed on 2026-02-02, counting submitted invoices; the daily cap is 8 h/),
    );
    await createInvoice(testDb, actor, { caseId, lines: [time(3)] });
  });

  it('requires a billing period within one month', async () => {
    const { actor, caseId } = await setup();
    await set('billing_period', 'require', { withinMonth: true });
    await expect(createInvoice(testDb, actor, { caseId, lines: [time(1)] })).rejects.toThrow(refused(/needs a billing period/));
    await expect(
      createInvoice(testDb, actor, { caseId, periodStart: '2026-01-20', periodEnd: '2026-02-10', lines: [time(1)] }),
    ).rejects.toThrow(refused(/within one calendar month/));
    await createInvoice(testDb, actor, { caseId, periodStart: '2026-02-01', periodEnd: '2026-02-28', lines: [time(1)] });
  });
});
