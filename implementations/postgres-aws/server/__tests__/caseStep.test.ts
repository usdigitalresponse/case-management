// The case step: cases found by number within a county, added from an
// invoice, or not for one case (scenarios/cases-from-invoices.md).
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { setDraftCaseNumber, setDraftCounty } from '../src/billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../src/billing/invoiceLifecycle/submit';
import { applyCaseChoiceAfterSend, caseStepFor, chooseCaseInReview, setDraftCaseChoice } from '../src/billing/caseChoice';
import { addCaseFromRequest, caseStepMatches } from '../src/cases/caseStep';
import { ForbiddenError, ValidationError } from '../src/errors';
import { auditEvent, caseAssignment, caseLifecycleEvent, caseParticipant, caseTable, county, invoice, invoiceLine, userAccount } from '../src/db/schema';
import { selectInvoiceHeaders } from '../src/billing/invoiceDetail';
import { describeQueue } from '../src/billing/reviewQueue';
import { changeInvoiceCounty } from '../src/billing/invoiceCounty';

let fixtures: BaselineFixtureIds;
let staff: PortalActor;
let countyB: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
  const [row] = await testDb.select({ countyId: county.countyId }).from(county).where(eq(county.displayName, 'County B'));
  countyB = row!.countyId;
});

afterAll(async () => {
  await testPool.end();
});

async function sender(email: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), professionalId };
}

async function addCase(caseNumber: string, countyId: string) {
  return testDb.transaction((tx) => addCaseFromRequest(tx, fixtures.staffUserAccountId, { caseNumber, countyId, confirmedNew: true }, { invoiceId: placeholder }));
}

let placeholder: string;

// A staff draft filed by person, with its number and county as read from the file.
async function staffDraft(caseNumber: string | null, countyId: string | null) {
  const { professionalId } = await sender(`sender-${Math.random()}@example.com`);
  const { invoiceId } = await createInvoice(testDb, staff, {
    caseId: null,
    professionalId,
    submit: false,
    lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 3, description: 'Court observation' }],
  });
  if (caseNumber) await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber });
  if (countyId) await setDraftCounty(testDb, staff, invoiceId, { countyId });
  return { invoiceId, professionalId };
}

const send = { filedByPerson: true, receivedVia: 'email', receivedOn: '2026-02-03' };

async function sendAsStaff(invoiceId: string) {
  await submitInvoice(testDb, staff, invoiceId, send);
  return applyCaseChoiceAfterSend(testDb, fixtures.staffUserAccountId, invoiceId);
}

beforeEach(async () => {
  placeholder = (await staffDraft(null, null)).invoiceId;
});

describe('finding a case by number within its county', () => {
  it('chooses the same number in the same county, offers close ones, and never another county’s', async () => {
    const exact = await addCase('CR-24-0477', fixtures.countyId);
    await addCase('CR-24-0477', countyB);

    const same = await caseStepMatches(testDb, 'cr-24-0477', fixtures.countyId);
    expect(same.exact?.caseId).toBe(exact);
    expect(same.similar).toEqual([]);

    const close = await caseStepMatches(testDb, 'CR240477', fixtures.countyId);
    expect(close.exact).toBeNull();
    expect(close.similar.map((row) => row.caseId)).toEqual([exact]);
  });
});

describe('adding a case from an invoice', () => {
  it('refuses a number already used in that county, and asks about a close one', async () => {
    await addCase('CR-24-0477', fixtures.countyId);
    const add = (caseNumber: string, countyId: string, confirmedNew = false) =>
      testDb.transaction((tx) => addCaseFromRequest(tx, fixtures.staffUserAccountId, { caseNumber, countyId, confirmedNew }, { invoiceId: placeholder }));

    await expect(add('cr-24-0477', fixtures.countyId, true)).rejects.toThrow(ValidationError);
    await expect(add('CR240477', fixtures.countyId)).rejects.toThrow(ValidationError);
    await expect(add('CR240477', fixtures.countyId, true)).resolves.toBeTruthy();
    // Another county's number is another case.
    await expect(add('CR-24-0477', countyB)).resolves.toBeTruthy();
  });

  it('records who added it and from which invoice, with a client only when named', async () => {
    const caseId = await testDb.transaction((tx) =>
      addCaseFromRequest(tx, fixtures.staffUserAccountId, { caseNumber: 'CR-26-1312', countyId: countyB, clientName: 'J. Sample' }, { invoiceId: placeholder }),
    );
    const [row] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, caseId));
    expect(row).toMatchObject({ externalReference: 'CR-26-1312', countyId: countyB, addedFromInvoiceId: placeholder, closedOn: null });
    const [opened] = await testDb.select().from(caseLifecycleEvent).where(eq(caseLifecycleEvent.caseId, caseId));
    expect(opened).toMatchObject({ sequenceNumber: 1, actorUserAccountId: fixtures.staffUserAccountId });
    expect(await testDb.select().from(caseParticipant).where(eq(caseParticipant.caseId, caseId))).toHaveLength(1);

    const bare = await addCase('CR-26-1313', countyB);
    expect(await testDb.select().from(caseParticipant).where(eq(caseParticipant.caseId, bare))).toHaveLength(0);
  });
});

describe('staff answering the case question', () => {
  it('must answer before sending', async () => {
    const { invoiceId } = await staffDraft('CR-26-1312', countyB);
    await expect(submitInvoice(testDb, staff, invoiceId, send)).rejects.toThrow(ValidationError);
  });

  it('match a found case when sent, adding its provider and keeping its prices', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    const { invoiceId, professionalId } = await staffDraft('CR-24-0477', fixtures.countyId);
    expect((await caseStepFor(testDb, invoiceId)).exact?.caseId).toBe(caseId);

    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId });
    expect(await sendAsStaff(invoiceId)).toEqual({ caseId, addedCaseId: null, caseProblem: null });

    const [sent] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(sent).toMatchObject({ caseId, caseChoice: 'existing', chosenCaseId: null, submittedTotal: '300.00' });
    const [line] = await testDb.select({ caseId: invoiceLine.caseId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    expect(line?.caseId).toBe(caseId);
    const assigned = await testDb
      .select()
      .from(caseAssignment)
      .where(and(eq(caseAssignment.caseId, caseId), eq(caseAssignment.professionalId, professionalId), isNull(caseAssignment.endedAt)));
    expect(assigned).toHaveLength(1);
  });

  it('add a new case when sent, only after saying a close one is different', async () => {
    await addCase('CR-24-0477', fixtures.countyId);
    const { invoiceId } = await staffDraft('CR240477', fixtures.countyId);
    await expect(setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'new' })).rejects.toThrow(ValidationError);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'new', confirmedNew: true, clientName: 'K. Sample' });

    const result = await sendAsStaff(invoiceId);
    expect(result.caseProblem).toBeNull();
    const [added] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, result.caseId!));
    expect(added).toMatchObject({ externalReference: 'CR240477', countyId: fixtures.countyId, addedFromInvoiceId: invoiceId });
    expect(result.addedCaseId).toBe(result.caseId);
  });

  it('needs a number and county to add a case', async () => {
    const { invoiceId } = await staffDraft(null, fixtures.countyId);
    await expect(setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'new' })).rejects.toThrow(ValidationError);
  });

  it('send work not for one case to review with only its county', async () => {
    const { invoiceId } = await staffDraft(null, countyB);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'none' });
    expect(await sendAsStaff(invoiceId)).toEqual({ caseId: null, addedCaseId: null, caseProblem: null });
    const [sent] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(sent).toMatchObject({ caseId: null, caseChoice: 'none', countyId: countyB });
  });
});

describe('a kept answer', () => {
  it('is asked again when the draft’s number or county changes, unless it is not for one case', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    const { invoiceId } = await staffDraft('CR-24-0477', fixtures.countyId);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId });
    await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber: 'CR-24-0477' });
    const answer = async () => (await testDb.select({ caseChoice: invoice.caseChoice, chosenCaseId: invoice.chosenCaseId }).from(invoice).where(eq(invoice.invoiceId, invoiceId)))[0];
    expect(await answer()).toEqual({ caseChoice: 'existing', chosenCaseId: caseId });

    await setDraftCounty(testDb, staff, invoiceId, { countyId: countyB });
    expect(await answer()).toEqual({ caseChoice: null, chosenCaseId: null });

    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'new', confirmedNew: true });
    await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber: 'CR240477' });
    expect(await answer()).toEqual({ caseChoice: null, chosenCaseId: null });

    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'none' });
    await setDraftCounty(testDb, staff, invoiceId, { countyId: fixtures.countyId });
    expect((await answer())?.caseChoice).toBe('none');
  });

  it('never chooses a case in another county', async () => {
    const elsewhere = await addCase('CR-24-0477', countyB);
    const { invoiceId } = await staffDraft('CR-24-0477', fixtures.countyId);
    await expect(setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId: elsewhere })).rejects.toThrow(ValidationError);
  });
});

describe('adding the same case at once', () => {
  it('adds it only once in a county', async () => {
    const results = await Promise.allSettled([addCase('CR-26-7000', countyB), addCase('CR-26-7000', countyB)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await testDb.select().from(caseTable).where(and(eq(caseTable.externalReference, 'CR-26-7000'), eq(caseTable.countyId, countyB)))).toHaveLength(1);
  });
});

describe('counties in the case step', () => {
  it('needs a county for work not for one case', async () => {
    const { invoiceId } = await staffDraft(null, null);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'none' });
    await expect(submitInvoice(testDb, staff, invoiceId, send)).rejects.toMatchObject({ fieldErrors: { countyId: expect.any(String) } });
  });

  it('needs the invoice’s county before choosing a case', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    const { invoiceId } = await staffDraft('CR-24-0477', null);
    await expect(setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId })).rejects.toMatchObject({ fieldErrors: { countyId: expect.any(String) } });
  });

  it('gives a chosen case with no county the invoice’s, recorded', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    await testDb.update(caseTable).set({ countyId: null }).where(eq(caseTable.caseId, caseId));
    const { invoiceId } = await staffDraft('CR-24-0477', countyB);
    expect((await caseStepFor(testDb, invoiceId)).similar.map((row) => row.caseId)).toEqual([caseId]);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId });
    expect((await sendAsStaff(invoiceId)).caseProblem).toBeNull();
    const [filled] = await testDb.select({ countyId: caseTable.countyId }).from(caseTable).where(eq(caseTable.caseId, caseId));
    expect(filled?.countyId).toBe(countyB);
    expect(await testDb.select().from(auditEvent).where(and(eq(auditEvent.entityId, caseId), eq(auditEvent.eventType, 'county_changed')))).toHaveLength(1);
  });

  it('says the same number is a case in another county, without offering it', async () => {
    const elsewhere = await addCase('CR-24-0477', countyB);
    const matches = await caseStepMatches(testDb, 'CR-24-0477', fixtures.countyId);
    expect(matches).toMatchObject({ exact: null, similar: [] });
    expect(matches.elsewhere.map((row) => row.caseId)).toEqual([elsewhere]);
  });

  it('flags an invoice whose county no longer matches its case’s', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    const { invoiceId } = await staffDraft('CR-24-0477', fixtures.countyId);
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId });
    await sendAsStaff(invoiceId);
    const flagsOf = async () => {
      const headers = await selectInvoiceHeaders(testDb).where(eq(invoice.invoiceId, invoiceId));
      return (await describeQueue(testDb, headers, { now: new Date() }))[0]!.flags.filter((flag) => flag.kind === 'county');
    };
    expect(await flagsOf()).toEqual([]);
    await changeInvoiceCounty(testDb, fixtures.staffUserAccountId, invoiceId, { countyId: countyB });
    expect(await flagsOf()).toEqual([{ kind: 'county', message: 'County differs from its case’s, County A' }]);
  });
});

describe('external submitters', () => {
  it('may type a case number or leave it out, but never answer the case question', async () => {
    const attorney = await sender('attorney@example.com');
    const { invoiceId } = await createInvoice(testDb, attorney.actor, {
      caseId: null,
      submit: false,
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 3, description: 'Court observation' }],
    });
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    await expect(setDraftCaseChoice(testDb, attorney.actor, invoiceId, { choice: 'existing', caseId })).rejects.toThrow(ForbiddenError);
    await expect(setDraftCaseChoice(testDb, attorney.actor, invoiceId, { choice: 'none' })).rejects.toThrow(ForbiddenError);
    expect(await submitInvoice(testDb, attorney.actor, invoiceId, { filedByPerson: true, attested: true })).toEqual({ invoiceId, status: 'submitted' });

    // A typed number is only suggested in review, never matched, even to the same number in the county.
    const typed = await createInvoice(testDb, attorney.actor, { caseId: null, submit: false, lines: [{ lineType: 'expense', serviceDate: '2026-02-02', amount: 10 }] });
    await setDraftCaseNumber(testDb, attorney.actor, typed.invoiceId, { caseNumber: 'CR-24-0477' });
    await setDraftCounty(testDb, attorney.actor, typed.invoiceId, { countyId: fixtures.countyId });
    await submitInvoice(testDb, attorney.actor, typed.invoiceId, { filedByPerson: true, attested: true });
    const [sent] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, typed.invoiceId));
    expect(sent).toMatchObject({ caseId: null, caseChoice: null, caseNumberAsTyped: 'CR-24-0477' });
    expect((await caseStepFor(testDb, typed.invoiceId)).exact?.caseId).toBe(caseId);
  });
});

describe('a reviewer choosing the case in review', () => {
  async function sentExternally(caseNumber: string) {
    const attorney = await sender(`attorney-${caseNumber}@example.com`);
    // The number stands in for one read from the sender's file.
    const { invoiceId } = await createInvoice(testDb, attorney.actor, {
      caseId: null,
      caseNumber,
      submit: false,
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Review' }],
    });
    await setDraftCounty(testDb, attorney.actor, invoiceId, { countyId: fixtures.countyId });
    await submitInvoice(testDb, attorney.actor, invoiceId, { filedByPerson: true, attested: true });
    return invoiceId;
  }

  it('suggests the same number in the county, and matches it when chosen', async () => {
    const caseId = await addCase('CR-24-0477', fixtures.countyId);
    const invoiceId = await sentExternally('CR-24-0477');
    const [before] = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(before?.caseId).toBeNull();
    expect((await caseStepFor(testDb, invoiceId)).exact?.caseId).toBe(caseId);

    await chooseCaseInReview(testDb, fixtures.staffUserAccountId, invoiceId, { choice: 'existing', caseId });
    const [after] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(after).toMatchObject({ caseId, caseChoice: 'existing', caseNumberAsTyped: 'CR-24-0477' });
  });

  it('adds a case from the invoice’s number, or records that it is not for one case', async () => {
    const added = await sentExternally('CR-26-2000');
    const result = await chooseCaseInReview(testDb, fixtures.staffUserAccountId, added, { choice: 'new' });
    expect(result.caseId).toBe(result.addedCaseId);

    const none = await sentExternally('CR-26-2001');
    await chooseCaseInReview(testDb, fixtures.staffUserAccountId, none, { choice: 'none' });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, none));
    expect(row).toMatchObject({ caseId: null, caseChoice: 'none' });
    // Once it has its case, it is not chosen again here.
    await expect(chooseCaseInReview(testDb, fixtures.staffUserAccountId, added, { choice: 'none' })).rejects.toThrow(ValidationError);
  });

  it('refuses a case in another county, and matches the case it added on a second try', async () => {
    const elsewhere = await addCase('CR-26-2100', countyB);
    const invoiceId = await sentExternally('CR-26-2100');
    await expect(chooseCaseInReview(testDb, fixtures.staffUserAccountId, invoiceId, { choice: 'existing', caseId: elsewhere })).rejects.toThrow(ValidationError);

    // As if matching failed after the case was added.
    const earlier = await testDb.transaction((tx) =>
      addCaseFromRequest(tx, fixtures.staffUserAccountId, { caseNumber: 'CR-26-2100', countyId: fixtures.countyId }, { invoiceId }),
    );
    const retried = await chooseCaseInReview(testDb, fixtures.staffUserAccountId, invoiceId, { choice: 'new' });
    expect(retried).toEqual({ caseId: earlier, addedCaseId: null, caseProblem: null });
  });

  it('is staff only', async () => {
    const attorney = await sender('outsider@example.com');
    const invoiceId = await sentExternally('CR-26-3000');
    await expect(chooseCaseInReview(testDb, attorney.actor.userAccountId, invoiceId, { choice: 'none' })).rejects.toThrow(ForbiddenError);
  });
});
