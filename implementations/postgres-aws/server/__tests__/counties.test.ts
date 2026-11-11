// A case's county, or a setting such as post-conviction in its place
// (model/rules.yaml record_case_county).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { auditEvent, caseAssignment, county, invoice, userAccount } from '../src/db/schema';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { setDraftCounty } from '../src/billing/invoiceLifecycle/drafts';
import { changeInvoiceCounty } from '../src/billing/invoiceCounty';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { countyKey, listCounties, readCounty, type CountyOption } from '../src/cases/counties';
import { ensureReferenceData } from '../src/db/ensureReferenceData';
import { ValidationError } from '../src/errors';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createSender(email: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  return resolvePortalActor(testDb, account!.userAccountId);
}

const line = { lineType: 'time' as const, serviceDate: '2026-03-02', quantity: 1, description: 'Review' };

describe('the county list', () => {
  it('lists the settings first, once however often reference data is ensured', async () => {
    await ensureReferenceData(testDb);
    const counties = await listCounties(testDb);
    expect(counties.slice(0, 2).map((row) => [row.displayName, row.isCounty])).toEqual([
      ['Post-conviction', false],
      ['Prison', false],
    ]);
    expect(counties.slice(2).every((row) => row.isCounty)).toBe(true);
  });

  it('treats spellings of one county as the same', () => {
    expect(countyKey('County of Sample')).toBe(countyKey('Sample County'));
    expect(countyKey('sample')).toBe(countyKey('SAMPLE  county'));
    expect(countyKey('Post conviction')).toBe(countyKey('Post-conviction'));
    expect(countyKey('County')).toBe('');
  });
});

describe('a county typed on an invoice', () => {
  it('is added once, reused however it is spelled, and audited', async () => {
    const actor = await createSender('sender@example.com');
    const first = await createInvoice(testDb, actor, { caseId: null, caseNumber: '26-CR-1', countyName: 'Sample County', submit: false, lines: [line] });
    const second = await createInvoice(testDb, actor, { caseId: null, caseNumber: '26-CR-2', countyName: ' county of  SAMPLE ', submit: false, lines: [line] });

    const rows = await testDb.select().from(invoice).where(eq(invoice.submittedByUserAccountId, actor.userAccountId));
    const ids = new Set(rows.map((row) => row.countyId));
    expect(ids.size).toBe(1);
    const [added] = await testDb.select().from(county).where(eq(county.countyId, [...ids][0]!));
    expect(added).toMatchObject({ displayName: 'Sample County', isCounty: true, active: true });
    const audits = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'county_added'));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: 'county', actorUserAccountId: actor.userAccountId });
    expect((await loadInvoiceDetail(testDb, second.invoiceId))?.invoice.countyDisplayName).toBe('Sample County');
    expect(first.invoiceId).not.toBe(second.invoiceId);
  });

  it('never brings back a county an administrator retired', async () => {
    const actor = await createSender('sender@example.com');
    await testDb.update(county).set({ active: false }).where(eq(county.displayName, 'County B'));
    await expect(
      createInvoice(testDb, actor, { caseId: null, caseNumber: '26-CR-1', countyName: 'county b', submit: false, lines: [line] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const [retired] = await testDb.select().from(county).where(eq(county.displayName, 'County B'));
    expect(retired?.active).toBe(false);
  });

  it('makes a county typed as a default setting into that setting', async () => {
    await testDb.delete(county).where(eq(county.displayName, 'Prison'));
    await testDb.insert(county).values({ displayName: 'prison', isCounty: true });
    await ensureReferenceData(testDb);
    const rows = await testDb.select().from(county).where(eq(county.displayName, 'prison'));
    expect(rows.map((row) => row.isCounty)).toEqual([false]);
    expect(await testDb.select().from(county).where(eq(county.displayName, 'Prison'))).toEqual([]);
  });

  it('is changed on a draft by its sender, and refused when it is only the word county', async () => {
    const actor = await createSender('sender@example.com');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId: null, caseNumber: '26-CR-1', submit: false, lines: [line] });
    const prison = (await listCounties(testDb)).find((row) => row.displayName === 'Prison')!;

    expect(await setDraftCounty(testDb, actor, invoiceId, { countyId: prison.countyId })).toMatchObject({
      county: { countyId: prison.countyId, displayName: 'Prison' },
    });
    await expect(setDraftCounty(testDb, actor, invoiceId, { countyName: 'County' })).rejects.toBeInstanceOf(ValidationError);
    // Saying nothing doesn't clear it; only countyId null does.
    await expect(setDraftCounty(testDb, actor, invoiceId, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(setDraftCounty(testDb, actor, invoiceId, { countyName: '  ' })).rejects.toBeInstanceOf(ValidationError);
    expect(await setDraftCounty(testDb, actor, invoiceId, { countyId: null })).toMatchObject({ county: null });
  });

  it('is changed by a reviewer once sent, keeping what it replaced', async () => {
    const actor = await createSender('sender@example.com');
    const reviewer = await createStaff('reviewer');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId: null, caseNumber: '26-CR-1', countyName: 'County A', attested: true, lines: [line] });
    const [before] = await testDb.select({ countyId: invoice.countyId }).from(invoice).where(eq(invoice.invoiceId, invoiceId));

    await expect(setDraftCounty(testDb, actor, invoiceId, { countyName: 'Prison' })).rejects.toThrow('Only a draft');
    expect(await changeInvoiceCounty(testDb, reviewer, invoiceId, { countyName: 'Post-conviction' })).toMatchObject({
      county: { displayName: 'Post-conviction' },
    });
    const [audit] = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'county_changed'));
    expect(audit).toMatchObject({ entityId: invoiceId, actorUserAccountId: reviewer, priorValues: { countyId: before!.countyId } });
  });
});

describe('an invoice under a case', () => {
  it('shows the case’s county, audits a change against it, and shows it again when its own is cleared', async () => {
    const actor = await createSender('sender@example.com');
    const reviewer = await createStaff('reviewer');
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-01T12:00:00Z'),
      countyId: fixtures.countyId,
    });
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId: actor.professionalId!,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, attested: true, lines: [line] });
    expect((await loadInvoiceDetail(testDb, invoiceId))?.invoice.countyId).toBe(fixtures.countyId);

    expect(await changeInvoiceCounty(testDb, reviewer, invoiceId, { countyName: 'Prison' })).toMatchObject({ county: { displayName: 'Prison' } });
    const [audit] = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'county_changed'));
    expect(audit?.priorValues).toEqual({ countyId: fixtures.countyId, ownCountyId: null });

    expect(await changeInvoiceCounty(testDb, reviewer, invoiceId, { countyId: null })).toMatchObject({
      county: { countyId: fixtures.countyId },
    });
  });
});

describe('reading the county from a file', () => {
  const options: CountyOption[] = [
    { countyId: 'pc', displayName: 'Post-conviction', isCounty: false },
    { countyId: 'pr', displayName: 'Prison', isCounty: false },
    { countyId: 'a', displayName: 'County A', isCounty: true },
    { countyId: 'sample', displayName: 'Sample County', isCounty: true },
  ];
  const read = (invoiceText: string, descriptions: string[] = []) =>
    readCounty({ invoiceText, lines: descriptions.map((description) => ({ location: '', lineType: 'time', amount: 1, description })) }, options);

  it('takes a labelled county first, matched to the list or new', () => {
    expect(read('Re: State v. Doe\nCounty: county of sample\nPost-conviction')).toEqual({ countyId: 'sample', displayName: 'Sample County' });
    expect(read('County: Example')).toEqual({ countyId: null, displayName: 'Example' });
    expect(read('County: Example   Invoice Date 10/31/2026')).toEqual({ countyId: null, displayName: 'Example' });
  });

  it('takes a setting named outside the items before a county', () => {
    expect(read('IN THE SUPERIOR COURT OF SAMPLE COUNTY\nPost Conviction Relief')).toEqual({ countyId: 'pc', displayName: 'Post-conviction' });
    // The item wraps, so the text doesn't hold it as the item does.
    expect(read('Superior Court of Sample County\nVisit client at\nprison', ['Visit client at prison'])).toEqual({
      countyId: 'sample',
      displayName: 'Sample County',
    });
  });

  it('finds a listed county however it is written, else names a new one', () => {
    expect(read('Superior Court of County A')).toEqual({ countyId: 'a', displayName: 'County A' });
    expect(read('IN THE CIRCUIT COURT OF EXAMPLE COUNTY')).toEqual({ countyId: null, displayName: 'Example County' });
    expect(read('District Court, County of Mt. Example')).toEqual({ countyId: null, displayName: 'Mt. Example County' });
    expect(read('Example County Superior Court')).toEqual({ countyId: null, displayName: 'Example County' });
    expect(read('a county jail visit')).toBeNull();
    // A name before "County" with no court named isn't taken for one.
    expect(read('Re: State v. Jane Doe Other County')).toBeNull();
    expect(read('Re: State v. Doe, Case No. 26-CR-1')).toBeNull();
  });
});
