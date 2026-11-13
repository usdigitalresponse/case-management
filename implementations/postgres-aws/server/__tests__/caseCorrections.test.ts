// Settings, Edit data: fixing cases added by mistake (scenarios/cases-from-invoices.md 8-10).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { setDraftCaseNumber, setDraftCounty } from '../src/billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../src/billing/invoiceLifecycle/submit';
import { applyCaseChoiceAfterSend, setDraftCaseChoice } from '../src/billing/caseChoice';
import { addCaseFromRequest } from '../src/cases/caseStep';
import { fixCase, listAddedCases, listCaseFixes, mergeCases, previewCaseFix, previewCaseMerge, undoCaseFix } from '../src/cases/caseCorrections';
import { listCaseBatch } from '../src/cases/caseBatches';
import { recordCeilingInTx } from '../src/billing/preauthorizations';
import { ConflictError, ValidationError } from '../src/errors';
import { caseAssignment, caseTable, county, invoice, invoiceLine, person, preauthorization, userAccount } from '../src/db/schema';
import { firstRow } from '../src/db/rowHelpers';

let fixtures: BaselineFixtureIds;
let countyB: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
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
  return professionalId;
}

// Sent by staff with a case added from it, as the upload page does.
async function sentWithNewCase(caseNumber: string, countyId: string, professionalId?: string) {
  const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
  const { invoiceId } = await createInvoice(testDb, staff, {
    caseId: null,
    professionalId: professionalId ?? (await sender(`sender-${caseNumber}-${Math.random()}@example.com`)),
    submit: false,
    lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Review' }],
  });
  await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber });
  await setDraftCounty(testDb, staff, invoiceId, { countyId });
  await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'new', confirmedNew: true });
  await submitInvoice(testDb, staff, invoiceId, { filedByPerson: true, receivedVia: 'email', receivedOn: '2026-02-03' });
  const { caseId } = await applyCaseChoiceAfterSend(testDb, fixtures.staffUserAccountId, invoiceId);
  return { invoiceId, caseId: caseId! };
}

const admin = () => fixtures.staffUserAccountId;

describe('cases added from requests', () => {
  it('are listed newest first, and narrowed to those with a close number in their county', async () => {
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const extra = await sentWithNewCase('CR240477', fixtures.countyId);
    await sentWithNewCase('CR-26-1312', countyB);

    const all = await listAddedCases(testDb);
    expect(all.map((row) => row.caseNumber)).toEqual(['CR-26-1312', 'CR240477', 'CR-24-0477']);
    expect(all[1]).toMatchObject({ addedFrom: 'invoice', invoices: 1, similar: [{ caseId: kept.caseId }] });
    const similar = await listAddedCases(testDb, { similarOnly: true });
    expect(similar.map((row) => row.caseId).sort()).toEqual([kept.caseId, extra.caseId].sort());
    expect(all[0]).toMatchObject({ caseNumber: 'CR-26-1312', elsewhere: [] });
    // Narrowed before the limit, so a newer case with no close number doesn't hide them.
    expect((await listAddedCases(testDb, { similarOnly: true, limit: 1 })).map((row) => row.caseId)).toEqual([extra.caseId]);
  });
});

describe('the same number in another county', () => {
  it('is shown as a hint, and counts as similar for the list', async () => {
    const inA = await sentWithNewCase('CR-26-1400', fixtures.countyId);
    const inB = await sentWithNewCase('CR-26-1400', countyB);
    const [row] = (await listAddedCases(testDb, { similarOnly: true })).filter((one) => one.caseId === inB.caseId);
    expect(row).toMatchObject({ similar: [], elsewhere: [{ caseId: inA.caseId, countyDisplayName: 'County A' }] });
  });
});

describe('the same case as another', () => {
  it('moves its invoices, even signed-off ones, closes it as a mistake, and can be undone', async () => {
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const extra = await sentWithNewCase('CR240477', fixtures.countyId);
    const fix = { kind: 'same_case', caseId: extra.caseId, keptCaseId: kept.caseId };

    const preview = await previewCaseFix(testDb, fix);
    expect(preview).toMatchObject({ invoices: [{ invoiceId: extra.invoiceId }], closes: true, preauthorizationChoices: [] });

    const { caseCorrectionId } = await fixCase(testDb, admin(), fix);
    const [moved] = await testDb.select({ caseId: invoice.caseId, total: invoice.submittedTotal }).from(invoice).where(eq(invoice.invoiceId, extra.invoiceId));
    expect(moved).toEqual({ caseId: kept.caseId, total: '200.00' });
    const [line] = await testDb.select({ caseId: invoiceLine.caseId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, extra.invoiceId));
    expect(line?.caseId).toBe(kept.caseId);
    const [closed] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, extra.caseId));
    expect(closed).toMatchObject({ closedAsMistake: true });
    expect(closed!.closedOn).not.toBeNull();
    // It leaves every list.
    const listed = await listCaseBatch(testDb, { show: 'all' }, { after: null, limit: 50 });
    expect(listed.items.map((row) => row.caseId)).not.toContain(extra.caseId);
    await expect(fixCase(testDb, admin(), fix)).rejects.toBeInstanceOf(ConflictError);

    expect(await undoCaseFix(testDb, admin(), caseCorrectionId)).toMatchObject({ leftAsIs: 0 });
    const [back] = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, extra.invoiceId));
    expect(back?.caseId).toBe(extra.caseId);
    const [reopened] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, extra.caseId));
    expect(reopened).toMatchObject({ closedAsMistake: false, closedOn: null });
    expect((await listCaseFixes(testDb))[0]).toMatchObject({ caseCorrectionId, kind: 'same_case' });
    await expect(undoCaseFix(testDb, admin(), caseCorrectionId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('asks which pre-authorization to keep when both cases have one for the same provider', async () => {
    const professionalId = await sender('both@example.com');
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId, professionalId);
    const extra = await sentWithNewCase('CR240477', fixtures.countyId, professionalId);
    for (const [caseId, amount] of [
      [kept.caseId, '1000.00'],
      [extra.caseId, '1500.00'],
    ] as const) {
      await testDb.transaction((tx) =>
        recordCeilingInTx(tx, admin(), { caseId, professionalId, amount, hourlyRate: undefined, authorizationNumber: null, requestedAt: new Date(), reason: null }),
      );
    }
    const fix = { kind: 'same_case', caseId: extra.caseId, keptCaseId: kept.caseId };
    await expect(fixCase(testDb, admin(), fix)).rejects.toBeInstanceOf(ValidationError);
    expect((await previewCaseFix(testDb, { ...fix, keepPreauthorizations: { [professionalId]: 'moved' } })).preauthorizationChoices).toHaveLength(1);

    await fixCase(testDb, admin(), { ...fix, keepPreauthorizations: { [professionalId]: 'moved' } });
    const onKept = await testDb.select().from(preauthorization).where(eq(preauthorization.caseId, kept.caseId));
    const onClosed = await testDb.select().from(preauthorization).where(eq(preauthorization.caseId, extra.caseId));
    expect(onKept).toHaveLength(1);
    expect(onClosed).toHaveLength(1);
  });

  it('never joins cases in different counties', async () => {
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const other = await sentWithNewCase('CR-24-0477', countyB);
    await expect(fixCase(testDb, admin(), { kind: 'same_case', caseId: other.caseId, keptCaseId: kept.caseId })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('merging a group of cases (Settings › Merge duplicates)', () => {
  it('previews each move after the ones before it, then moves them all, each undone on its own', async () => {
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const second = await sentWithNewCase('CR240477', fixtures.countyId);
    const third = await sentWithNewCase('CR 24 0477', fixtures.countyId);
    const merge = { keptCaseId: kept.caseId, caseIds: [second.caseId, third.caseId] };

    const { cases } = await previewCaseMerge(testDb, admin(), merge);
    expect(cases.map((one) => [one.caseId, one.invoices.map((row) => row.invoiceId)])).toEqual([
      [second.caseId, [second.invoiceId]],
      [third.caseId, [third.invoiceId]],
    ]);
    // The preview rolls back.
    const [untouched] = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, second.invoiceId));
    expect(untouched?.caseId).toBe(second.caseId);

    const { caseCorrectionIds } = await mergeCases(testDb, admin(), merge);
    expect(caseCorrectionIds).toHaveLength(2);
    const moved = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(inArray(invoice.invoiceId, [second.invoiceId, third.invoiceId]));
    expect(moved.map((row) => row.caseId)).toEqual([kept.caseId, kept.caseId]);

    await undoCaseFix(testDb, admin(), caseCorrectionIds[0]!);
    const [back] = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, second.invoiceId));
    expect(back?.caseId).toBe(second.caseId);
  });

  it('moves none if any one cannot be moved', async () => {
    const kept = await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const second = await sentWithNewCase('CR240477', fixtures.countyId);
    const elsewhere = await sentWithNewCase('CR-24-0477', countyB);

    await expect(mergeCases(testDb, admin(), { keptCaseId: kept.caseId, caseIds: [second.caseId, elsewhere.caseId] })).rejects.toThrow();
    const [stayed] = await testDb.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, second.invoiceId));
    expect(stayed?.caseId).toBe(second.caseId);
  });
});

describe('correcting a case', () => {
  it('changes its number, county and client, refusing a number already used in that county', async () => {
    await sentWithNewCase('CR-24-0477', fixtures.countyId);
    const wrong = await sentWithNewCase('CR-24-9999', fixtures.countyId);
    await expect(fixCase(testDb, admin(), { kind: 'corrected', caseId: wrong.caseId, caseNumber: 'CR-24-0477' })).rejects.toBeInstanceOf(ValidationError);

    const { caseCorrectionId } = await fixCase(testDb, admin(), { kind: 'corrected', caseId: wrong.caseId, countyId: countyB, clientName: 'L. Sample' });
    const [row] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, wrong.caseId));
    expect(row).toMatchObject({ countyId: countyB, externalReference: 'CR-24-9999', closedAsMistake: false });
    expect(row!.clientId).not.toBeNull();
    const [sent] = await testDb.select({ caseNumberAsTyped: invoice.caseNumberAsTyped }).from(invoice).where(eq(invoice.invoiceId, wrong.invoiceId));
    expect(sent?.caseNumberAsTyped).toBe('CR-24-9999');

    await undoCaseFix(testDb, admin(), caseCorrectionId);
    const [undone] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, wrong.caseId));
    expect(undone).toMatchObject({ countyId: fixtures.countyId, clientId: null });
  });
});

describe('not for one case', () => {
  it('takes its invoices off it, keeping their county, and closes it', async () => {
    const added = await sentWithNewCase('CR-26-4000', countyB);
    await fixCase(testDb, admin(), { kind: 'not_for_case', caseId: added.caseId });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, added.invoiceId));
    expect(row).toMatchObject({ caseId: null, caseChoice: 'none', countyId: countyB });
    const [closed] = await testDb.select({ closedAsMistake: caseTable.closedAsMistake }).from(caseTable).where(eq(caseTable.caseId, added.caseId));
    expect(closed?.closedAsMistake).toBe(true);
  });
});

describe('correcting a client other records share', () => {
  it('adds a new client rather than renaming the person everywhere, and undo puts the earlier one back', async () => {
    const added = await sentWithNewCase('CR-26-6000', countyB);
    const other = await sentWithNewCase('CR-26-6001', countyB);
    const sharedId = firstRow(await testDb.insert(person).values({ displayName: 'M. Sample' }).returning()).personId;
    await testDb.update(caseTable).set({ clientId: sharedId }).where(inArray(caseTable.caseId, [added.caseId, other.caseId]));

    const { caseCorrectionId } = await fixCase(testDb, admin(), { kind: 'corrected', caseId: added.caseId, clientName: 'N. Sample' });
    const [shared] = await testDb.select().from(person).where(eq(person.personId, sharedId));
    expect(shared?.displayName).toBe('M. Sample');
    const [row] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, added.caseId));
    expect(row!.clientId).not.toBe(sharedId);

    await undoCaseFix(testDb, admin(), caseCorrectionId);
    const [undone] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, added.caseId));
    expect(undone?.clientId).toBe(sharedId);
  });

  it('renames a client only this case has', async () => {
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const { invoiceId } = await createInvoice(testDb, staff, { caseId: null, professionalId: await sender('own@example.com'), submit: false, lines: [] });
    const caseId = await testDb.transaction((tx) => addCaseFromRequest(tx, admin(), { caseNumber: 'CR-26-6002', countyId: countyB, clientName: 'O. Sampel' }, { invoiceId }));
    const [before] = await testDb.select({ clientId: caseTable.clientId }).from(caseTable).where(eq(caseTable.caseId, caseId));
    await fixCase(testDb, admin(), { kind: 'corrected', caseId, clientName: 'O. Sample' });
    const [renamed] = await testDb.select().from(person).where(eq(person.personId, before!.clientId!));
    expect(renamed?.displayName).toBe('O. Sample');
  });
});

describe('undoing a fix that closed a case', () => {
  it('leaves the assignments it ended ended', async () => {
    const added = await sentWithNewCase('CR-26-6100', countyB);
    const open = () => testDb.select().from(caseAssignment).where(and(eq(caseAssignment.caseId, added.caseId), isNull(caseAssignment.endedAt)));
    expect(await open()).toHaveLength(1);
    const { caseCorrectionId } = await fixCase(testDb, admin(), { kind: 'not_for_case', caseId: added.caseId });
    expect(await open()).toHaveLength(0);
    expect(await undoCaseFix(testDb, admin(), caseCorrectionId)).toMatchObject({ leftAsIs: 1 });
    expect(await open()).toHaveLength(0);
  });
});

describe('a draft that chose a case taken off', () => {
  it('is asked again', async () => {
    const added = await sentWithNewCase('CR-26-6200', countyB);
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const { invoiceId } = await createInvoice(testDb, staff, { caseId: null, professionalId: await sender('draft@example.com'), submit: false, lines: [] });
    await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber: 'CR-26-6200' });
    await setDraftCounty(testDb, staff, invoiceId, { countyId: countyB });
    await setDraftCaseChoice(testDb, staff, invoiceId, { choice: 'existing', caseId: added.caseId });

    await fixCase(testDb, admin(), { kind: 'not_for_case', caseId: added.caseId });
    const [draft] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(draft).toMatchObject({ caseChoice: null, chosenCaseId: null });
  });
});

describe('a case added from a pre-authorization request', () => {
  it('is listed as added from one', async () => {
    const { invoiceId } = await sentWithNewCase('CR-26-5000', countyB);
    await testDb.transaction((tx) => addCaseFromRequest(tx, admin(), { caseNumber: 'CR-26-5001', countyId: countyB }, { invoiceId }));
    expect((await listAddedCases(testDb))[0]).toMatchObject({ caseNumber: 'CR-26-5001', invoices: 0 });
  });
});
