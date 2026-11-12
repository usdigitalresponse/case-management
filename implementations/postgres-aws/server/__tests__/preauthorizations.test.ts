// The pre-authorization rules in model/rules.yaml. Amounts are synthetic.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { memoryStore } from './memoryStore';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { loadPreauthorizationSummaries, setPreauthorizedAmount } from '../src/billing/preauthorizations';
import { addThreshold, getThresholdSettings, setKindThresholdApplies, thresholdFor } from '../src/billing/preauthorizationThresholds';
import { loadOverrunExplanations } from '../src/billing/overrunExplanation';
import { addDocument, providerDocumentStatus } from '../src/billing/preauthorizationRequests/providerRecords';
import { answerRequestQuestion, askRequestQuestion, decidePreauthorizationRequest, matchPreauthorizationRequest, withdrawPreauthorizationRequest } from '../src/billing/preauthorizationRequests/decide';
import { createPreauthorizationRequest, previewRequest } from '../src/billing/preauthorizationRequests/submit';
import { getPreauthorizationRequest, listOwnPreauthorizationRequests, listPreauthorizationRequests } from '../src/billing/preauthorizationRequests/read';
import { preauthorizationUsageByCounty } from '../src/billing/preauthorizationUsage';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/errors';
import { caseAssignment, caseTable, county, preauthorizationDecision, preauthorizationRequest, userAccount } from '../src/db/schema';
import { fixCase, undoCaseFix } from '../src/cases/caseCorrections';

let fixtures: BaselineFixtureIds;
let admin: string;
let staff: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  admin = await createStaff('admin', 'Admin One');
  staff = await createStaff('staff', 'Staff One');
});

afterAll(async () => {
  await testPool.end();
});

async function newCase(countyId: string | null = fixtures.countyId): Promise<string> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-01T12:00:00Z'),
    ...(countyId ? { countyId } : {}),
  });
  return caseId;
}

async function newProvider(caseId: string, { bound }: { bound: boolean }): Promise<PortalActor & { professionalId: string }> {
  const email = `${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  const kindId = await giveRate(testDb, admin, professionalId, 100);
  if (bound) await setKindThresholdApplies(testDb, admin, kindId, { thresholdApplies: true });
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date('2026-01-01T12:00:00Z'),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return { ...(await resolvePortalActor(testDb, account!.userAccountId)), professionalId };
}

const request = (caseId: string, professionalId: string, requestedAmount: number, extra: Record<string, unknown> = {}) => ({
  caseId,
  professionalId,
  serviceDescription: 'Synthetic investigation',
  rateBasis: 'hourly',
  requestedRate: 50,
  estimatedQuantity: requestedAmount / 50,
  requestedAmount,
  justification: 'Synthetic reason',
  ...extra,
});

const hours = (quantity: number) => ({ lineType: 'time' as const, serviceDate: '2026-02-02', quantity, description: `Work ${quantity}` });

describe('thresholds', () => {
  it('fall back to the default, take a county’s own from its date and keep their history', async () => {
    const [other] = await testDb.insert(county).values({ displayName: 'Synthetic County B' }).returning();
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    await addThreshold(testDb, admin, { countyId: other!.countyId, amount: 1500, effectiveFrom: '2025-06-01' });
    await addThreshold(testDb, admin, { countyId: other!.countyId, amount: 9000, effectiveFrom: '2099-01-01' });
    expect(await thresholdFor(testDb, fixtures.countyId)).toBe('1000.00');
    expect(await thresholdFor(testDb, other!.countyId)).toBe('1500.00');
    // An empty amount returns the county to the default.
    await addThreshold(testDb, admin, { countyId: other!.countyId, amount: null, effectiveFrom: '2025-07-01' });
    expect(await thresholdFor(testDb, other!.countyId)).toBe('1000.00');
    expect((await getThresholdSettings(testDb)).history).toHaveLength(4);
    await expect(addThreshold(testDb, staff, { countyId: null, amount: 5, effectiveFrom: '2025-01-01' })).rejects.toThrow(ForbiddenError);
    await expect(addThreshold(testDb, admin, { countyId: null, amount: null, effectiveFrom: '2025-01-01' })).rejects.toThrow(ValidationError);
  });

  it('apply only to bound kinds, giving a limit with no pre-authorization', async () => {
    const caseId = await newCase();
    const investigator = await newProvider(caseId, { bound: true });
    const attorney = await newProvider(caseId, { bound: false });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    const summaries = await loadPreauthorizationSummaries(testDb, caseId, [investigator.professionalId, attorney.professionalId]);
    expect(summaries).toEqual([expect.objectContaining({ professionalId: investigator.professionalId, source: 'threshold', ceiling: '1000.00' })]);
  });
});

describe('requests', () => {
  it('are numbered, wait for answers, and approve a different total on one pre-authorization', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const expert = await newProvider(caseId, { bound: true });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });

    expect(await previewRequest(testDb, attorney, { caseId, professionalId: expert.professionalId, requestedAmount: 750 })).toMatchObject({
      threshold: '1000.00',
      withinThreshold: true,
      documents: { missing: ['cv', 'fee_schedule'] },
    });

    const first = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 2400));
    const second = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 500));
    const year = new Date().toISOString().slice(2, 4);
    expect([first.requestNumber, second.requestNumber]).toEqual([`${year}-001`, `${year}-002`]);

    const staffActor = await resolvePortalActor(testDb, staff);
    const asked = await askRequestQuestion(testDb, staff, first.preauthorizationRequestId, { question: 'Why is it needed?' });
    expect(asked.request.statusCode).toBe('info_requested');
    await expect(
      decidePreauthorizationRequest(testDb, staff, first.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 2000 }),
    ).rejects.toThrow(ValidationError);
    const answered = await answerRequestQuestion(testDb, attorney.userAccountId, first.preauthorizationRequestId, asked.questions[0]!.preauthorizationQuestionId, {
      answer: 'Synthetic answer',
    });
    expect(answered.request.statusCode).toBe('submitted');
    await expect(
      answerRequestQuestion(testDb, attorney.userAccountId, first.preauthorizationRequestId, asked.questions[0]!.preauthorizationQuestionId, { answer: 'Again' }),
    ).rejects.toThrow(ValidationError);

    const approved = await decidePreauthorizationRequest(testDb, staff, first.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 2000 });
    expect(approved.request).toMatchObject({ statusCode: 'approved', approvedAmount: '2000.00', approvedHourlyRate: '50.00' });
    await expect(decidePreauthorizationRequest(testDb, staff, first.preauthorizationRequestId, { outcome: 'denied', reason: 'x' })).rejects.toThrow(ConflictError);

    // Asking for more revises the same pre-authorization; ceilings replace.
    const more = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 3000));
    await decidePreauthorizationRequest(testDb, staff, more.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 3000 });
    const [summary] = await loadPreauthorizationSummaries(testDb, caseId);
    expect(summary).toMatchObject({ professionalId: expert.professionalId, source: 'preauthorized', ceiling: '3000.00' });
    const decisions = await testDb.select().from(preauthorizationDecision).where(eq(preauthorizationDecision.preauthorizationId, summary!.preauthorizationId!));
    expect(decisions).toHaveLength(2);

    await expect(decidePreauthorizationRequest(testDb, staff, second.preauthorizationRequestId, { outcome: 'not_needed' })).rejects.toThrow(ValidationError);
    const notNeeded = await decidePreauthorizationRequest(testDb, staff, second.preauthorizationRequestId, { outcome: 'not_needed', reason: 'Within the threshold' });
    expect(notNeeded.request).toMatchObject({ statusCode: 'not_needed', outcomeCode: 'not_needed', decisionReason: 'Within the threshold' });
    expect(staffActor.userAccountId).toBe(staff);
  });

  it('are read and withdrawn only by their requester or staff', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const outsiderCase = await newCase();
    const outsider = await newProvider(outsiderCase, { bound: false });
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, request(caseId, attorney.professionalId, 900));
    await expect(getPreauthorizationRequest(testDb, outsider.userAccountId, preauthorizationRequestId)).rejects.toThrow(NotFoundError);
    await expect(createPreauthorizationRequest(testDb, outsider, request(caseId, attorney.professionalId, 900))).rejects.toThrow(ForbiddenError);
    await expect(askRequestQuestion(testDb, attorney.userAccountId, preauthorizationRequestId, { question: 'Mine?' })).rejects.toThrow(ForbiddenError);
    expect((await listOwnPreauthorizationRequests(testDb, outsider, undefined, { limit: 50, after: null })).items).toHaveLength(0);
    const withdrawn = await withdrawPreauthorizationRequest(testDb, attorney.userAccountId, preauthorizationRequestId);
    expect(withdrawn.request.statusCode).toBe('withdrawn');
  });

  it('are counted by status for staff, whichever status is listed', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const expert = await newProvider(caseId, { bound: true });
    const waiting = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 900));
    const asked = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 1200));
    const approved = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 1500));
    await askRequestQuestion(testDb, staff, asked.preauthorizationRequestId, { question: 'Why is it needed?' });
    await decidePreauthorizationRequest(testDb, staff, approved.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 1500 });

    const first = await listPreauthorizationRequests(testDb, staff, { status: 'approved' }, { limit: 1, after: null });
    expect(first.items.map((row) => row.preauthorizationRequestId)).toEqual([approved.preauthorizationRequestId]);
    expect('summary' in first && first.summary.counts).toEqual({ submitted: 1, info_requested: 1, approved: 1, not_needed: 0, denied: 0, withdrawn: 0, all: 3 });

    const more = await createPreauthorizationRequest(testDb, attorney, request(caseId, expert.professionalId, 700));
    const open = await listPreauthorizationRequests(testDb, staff, { status: 'submitted' }, { limit: 1, after: null });
    const rest = await listPreauthorizationRequests(testDb, staff, { status: 'submitted' }, { limit: 1, after: JSON.parse(Buffer.from(open.next!, 'base64url').toString()) as string[] });
    expect([...open.items, ...rest.items].map((row) => row.preauthorizationRequestId).sort()).toEqual([waiting.preauthorizationRequestId, more.preauthorizationRequestId].sort());
    expect('summary' in rest).toBe(false);
  });

  it('keep a proposed case and provider until staff match them', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, {
      ...request(caseId, attorney.professionalId, 1200),
      caseId: null,
      professionalId: null,
      proposedCase: { caseNumber: 'SYN-404' },
      proposedProvider: { name: 'Synthetic Investigations' },
    });
    await expect(
      decidePreauthorizationRequest(testDb, staff, preauthorizationRequestId, { outcome: 'approved', approvedAmount: 1200 }),
    ).rejects.toThrow(
      expect.objectContaining({ fieldErrors: { outcome: expect.stringContaining('Match the provider') } }),
    );
    const view = await getPreauthorizationRequest(testDb, staff, preauthorizationRequestId);
    expect(view.request).toMatchObject({ proposedCaseNumber: 'SYN-404', proposedProviderName: 'Synthetic Investigations' });
  });

  it('add the case from its number and county when staff match it', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, {
      ...request(caseId, attorney.professionalId, 1200),
      caseId: null,
      proposedCase: { caseNumber: 'SYN-405', countyId: fixtures.countyId },
    });
    const matched = await matchPreauthorizationRequest(testDb, staff, preauthorizationRequestId, {
      newCase: { caseNumber: 'SYN-405', countyId: fixtures.countyId },
    });
    expect(matched.addedCaseId).toBeTruthy();
    const [added] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, matched.addedCaseId!));
    expect(added).toMatchObject({ externalReference: 'SYN-405', addedFromPreauthorizationRequestId: preauthorizationRequestId });
    await decidePreauthorizationRequest(testDb, staff, preauthorizationRequestId, { outcome: 'approved', approvedAmount: 1200 });
    const [limit] = await loadPreauthorizationSummaries(testDb, matched.addedCaseId!, [attorney.professionalId]);
    expect(limit).toMatchObject({ source: 'preauthorized', ceiling: '1200.00' });
  });

  it('refuse a case in another county than the request’s', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const [other] = await testDb.insert(county).values({ displayName: 'Synthetic County C' }).returning();
    const elsewhere = await newCase(other!.countyId);
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, {
      ...request(caseId, attorney.professionalId, 1200),
      caseId: null,
      proposedCase: { caseNumber: 'SYN-406', countyId: fixtures.countyId },
    });
    await expect(matchPreauthorizationRequest(testDb, staff, preauthorizationRequestId, { caseId: elsewhere })).rejects.toThrow(ValidationError);
    await expect(matchPreauthorizationRequest(testDb, staff, preauthorizationRequestId, { caseId })).resolves.toMatchObject({ request: { caseId } });
  });

  it('keep their own county when an administrator takes them off a case added by mistake', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const [other] = await testDb.insert(county).values({ displayName: 'Synthetic County D' }).returning();
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, request(caseId, attorney.professionalId, 900));
    await testDb.update(preauthorizationRequest).set({ countyId: other!.countyId }).where(eq(preauthorizationRequest.preauthorizationRequestId, preauthorizationRequestId));

    const { caseCorrectionId } = await fixCase(testDb, admin, { kind: 'not_for_case', caseId });
    const [taken] = await testDb.select().from(preauthorizationRequest).where(eq(preauthorizationRequest.preauthorizationRequestId, preauthorizationRequestId));
    expect(taken).toMatchObject({ caseId: null, notForCase: true, countyId: other!.countyId });
    await undoCaseFix(testDb, admin, caseCorrectionId);
    const [back] = await testDb.select().from(preauthorizationRequest).where(eq(preauthorizationRequest.preauthorizationRequestId, preauthorizationRequestId));
    expect(back).toMatchObject({ caseId, notForCase: false, countyId: other!.countyId });
  });

  it('record only the decision for work not for one case, setting no limit', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const decisionsBefore = await testDb.select().from(preauthorizationDecision);
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, {
      ...request(caseId, attorney.professionalId, 900),
      caseId: null,
      notForCase: true,
      countyId: fixtures.countyId,
      serviceDescription: 'Court observation',
    });
    await decidePreauthorizationRequest(testDb, staff, preauthorizationRequestId, { outcome: 'approved', approvedAmount: 900 });
    const view = await getPreauthorizationRequest(testDb, staff, preauthorizationRequestId);
    expect(view.request).toMatchObject({ caseId: null, notForCase: true, statusCode: 'approved', approvedAmount: '900.00', countyId: fixtures.countyId });
    expect(await testDb.select().from(preauthorizationDecision)).toHaveLength(decisionsBefore.length);
  });
});

describe('overruns', () => {
  it('need the submitter’s explanation to send, are still reviewable and are flagged', async () => {
    const caseId = await newCase();
    const investigator = await newProvider(caseId, { bound: true });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    await createInvoice(testDb, investigator, { attested: true, caseId, lines: [hours(8)] });
    // 800 waiting; 400 more goes over 1,000.
    await expect(createInvoice(testDb, investigator, { attested: true, caseId, lines: [hours(4)] })).rejects.toThrow(
      expect.objectContaining({ fieldErrors: { overrunExplanation: expect.stringMatching(/\$1,200\.00 on this case, over the \$1,000\.00 threshold/) } }),
    );
    const { invoiceId } = await createInvoice(testDb, investigator, {
      attested: true,
      caseId,
      lines: [hours(4)],
      overrunExplanation: 'Synthetic explanation',
    });
    expect(await loadOverrunExplanations(testDb, invoiceId)).toEqual([
      expect.objectContaining({ limit: '1000.00', source: 'threshold', total: '1200.00', explanation: 'Synthetic explanation' }),
    ]);
    const { invoices } = await listReviewQueue(testDb, 'all', { caseId });
    const flagged = invoices.find((row) => row.invoiceId === invoiceId)!;
    expect(flagged.flags).toContainEqual(expect.objectContaining({ kind: 'preauthorization', message: 'Over the threshold $1,000.00' }));
  });
});

describe('usage by county', () => {
  it('counts requests, billing, overruns and work within the threshold', async () => {
    const caseId = await newCase();
    const investigator = await newProvider(caseId, { bound: true });
    const expert = await newProvider(caseId, { bound: true });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    await createInvoice(testDb, investigator, { attested: true, caseId, lines: [hours(5)] });
    await createInvoice(testDb, expert, { attested: true, caseId, lines: [hours(12)], overrunExplanation: 'Synthetic' });
    const asked = await createPreauthorizationRequest(testDb, investigator, request(caseId, investigator.professionalId, 2000));
    await decidePreauthorizationRequest(testDb, staff, asked.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 1500 });
    await createPreauthorizationRequest(testDb, investigator, request(caseId, expert.professionalId, 400));
    const year = new Date().getUTCFullYear();
    const usage = await preauthorizationUsageByCounty(testDb, staff, { from: `${year}-01-01`, to: `${year}-12-31` });
    expect(usage.counties).toHaveLength(1);
    expect(usage.counties[0]).toMatchObject({
      countyId: fixtures.countyId,
      threshold: '1000.00',
      requests: { submitted: 1, approved: 1 },
      requested: '2400.00',
      approved: '1500.00',
      billedWaiting: '1700.00',
      left: '1000.00',
      over: { providers: 1, amount: '200.00', unexplained: 0 },
      withinThreshold: { providers: 0 },
    });
    await expect(preauthorizationUsageByCounty(testDb, investigator.userAccountId, { from: `${year}-01-01`, to: `${year}-12-31` })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('provider documents', () => {
  it('are kept on file and stop being asked for', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const expert = await newProvider(caseId, { bound: true });
    const store = memoryStore();
    const pdf = Buffer.from('%PDF-1.4 synthetic');
    await addDocument(testDb, store, attorney, { professionalId: expert.professionalId }, { bytes: pdf, fileName: 'cv.pdf', purpose: 'cv' });
    expect((await providerDocumentStatus(testDb, expert.professionalId)).missing).toEqual(['fee_schedule']);
    await expect(
      addDocument(testDb, store, attorney, { professionalId: expert.professionalId }, { bytes: Buffer.from('plain'), fileName: 'x.txt', purpose: 'cv' }),
    ).rejects.toThrow(ValidationError);
  });

  it('are not shown or added to someone with no tie to the provider, nor to a decided request', async () => {
    const caseId = await newCase();
    const attorney = await newProvider(caseId, { bound: false });
    const outsider = await newProvider(await newCase(), { bound: false });
    const pdf = Buffer.from('%PDF-1.4 synthetic');
    await expect(previewRequest(testDb, outsider, { professionalId: attorney.professionalId })).rejects.toThrow(NotFoundError);
    const { preauthorizationRequestId } = await createPreauthorizationRequest(testDb, attorney, request(caseId, attorney.professionalId, 900));
    await withdrawPreauthorizationRequest(testDb, attorney.userAccountId, preauthorizationRequestId);
    await expect(
      addDocument(testDb, memoryStore(), attorney, { preauthorizationRequestId }, { bytes: pdf, fileName: 'q.pdf', purpose: 'quote' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('limits', () => {
  it('use a whole-case pre-authorization before the threshold', async () => {
    const caseId = await newCase();
    const expert = await newProvider(caseId, { bound: true });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    await setPreauthorizedAmount(testDb, staff, caseId, { professionalId: null, amount: 10000 });
    const { invoiceId } = await createInvoice(testDb, expert, { attested: true, caseId, lines: [hours(15)] });
    expect(await loadOverrunExplanations(testDb, invoiceId)).toEqual([]);
    const summaries = await loadPreauthorizationSummaries(testDb, caseId, [expert.professionalId]);
    expect(summaries.map((summary) => summary.source)).toEqual(['preauthorized']);
  });

  it('are not called "not needed" when the total asked for is below what is billed', async () => {
    const caseId = await newCase();
    const investigator = await newProvider(caseId, { bound: true });
    await addThreshold(testDb, admin, { countyId: null, amount: 1000, effectiveFrom: '2025-01-01' });
    await createInvoice(testDb, investigator, { attested: true, caseId, lines: [hours(9)] });
    const preview = (amount: number) => previewRequest(testDb, investigator, { caseId, professionalId: investigator.professionalId, requestedAmount: amount });
    expect(await preview(500)).toMatchObject({ billed: '900.00', withinThreshold: false });
    expect(await preview(950)).toMatchObject({ withinThreshold: true });
  });

  it('let an approval clear the hourly rate', async () => {
    const caseId = await newCase();
    const expert = await newProvider(caseId, { bound: true });
    const first = await createPreauthorizationRequest(testDb, expert, request(caseId, expert.professionalId, 2000));
    await decidePreauthorizationRequest(testDb, staff, first.preauthorizationRequestId, { outcome: 'approved', approvedAmount: 2000 });
    const flat = await createPreauthorizationRequest(testDb, expert, { ...request(caseId, expert.professionalId, 3000), rateBasis: 'flat', requestedRate: null });
    const decided = await decidePreauthorizationRequest(testDb, staff, flat.preauthorizationRequestId, {
      outcome: 'approved',
      approvedAmount: 3000,
      approvedHourlyRate: null,
    });
    expect(decided.request).toMatchObject({ approvedAmount: '3000.00', approvedHourlyRate: null });
  });
});
