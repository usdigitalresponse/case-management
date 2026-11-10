// Staff uploads entered and decided in one pass (../src/billing/enterInReview.ts).
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { createCase } from '../src/intake/createCase';
import { giveRate } from './rateHelpers';
import { addKindRate, createKind } from '../src/billing/professionalRates';
import { addProfessional } from '../src/professionals/addProfessional';
import { removeProfessional } from '../src/professionals/removeProfessional';
import { correctNewProfessional } from '../src/professionals/correctNewProfessional';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import {
  canDiscardEntry,
  confirmEnteredImport,
  DecisionsUndoneError,
  enterDraftInReview,
  saveEnteredLines,
  setEnteredCaseNumber,
  setEnteredDetails,
  setEnteredReceipt,
  setEnteredSender,
} from '../src/billing/enterInReview';
import { recallInvoice, setDraftDetails, setDraftSender } from '../src/billing/invoiceLifecycle';
import { createDraftFromUpload, startUploadRead } from '../src/imports/splitByCase';
import { correctCaseNumber } from '../src/billing/correctCaseNumber';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { extractionsSettled } from '../src/imports/extractionJobs';
import { memoryStore } from './memoryStore';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { finishReview, reopenReview } from '../src/billing/reviewRounds';
import { reassignReviewer } from '../src/billing/reviewAssignment';
import { askQuestion } from '../src/billing/reviewQuestions';
import { setReviewSettings } from '../src/billing/reviewSettings';
import { loadInvoiceDetail, loadSenderEmail } from '../src/billing/invoiceDetail';
import { deleteUnsubmittedInvoice } from '../src/billing/deleteInvoice';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import {
  auditEvent,
  caseAssignment,
  invoice,
  invoiceApprovalChain,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  person,
  professional,
  supportingInvoice,
  userAccount,
} from '../src/db/schema';
import type { DocumentStore } from '../src/imports/documentStore';

let fixtures: BaselineFixtureIds;
let reviewer: string;
let approver: string;

const noFiles = { delete: async () => undefined } as unknown as DocumentStore;
const receipt = { receivedVia: 'email', receivedOn: '2026-02-03' };
const CSV = Buffer.from(['date,type,description,hours,amount', '2026-02-02,expense,Filing fee,,40', ''].join('\n'));
const TIME_CSV = Buffer.from(['date,type,description,hours,amount', '2026-02-02,time,Research,2,300', ''].join('\n'));

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer', 'Reviewer One');
  approver = await createStaff('approver', 'Approver One');
  await setReviewSettings(testDb, fixtures.staffUserAccountId, { defaultSignOffUserAccountIds: [approver] });
});

afterAll(async () => {
  await testPool.end();
});

async function sender(rate = 100) {
  const email = `sender-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: 'Sample Sender', email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, rate);
  return professionalId;
}

// Entered by hand by the reviewer, filed under its sender, as the upload page makes it.
async function upload(lines: Array<{ amount: number; description: string }>) {
  const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
    caseId: null,
    professionalId: await sender(),
    submit: false,
    enterInReview: true,
    caseNumber: '26-CR-00418',
    lines: lines.map((line) => ({ lineType: 'expense' as const, serviceDate: '2026-02-02', ...line })),
  });
  return invoiceId;
}

async function linesVersion(invoiceId: string) {
  const [row] = await testDb.select({ version: invoice.linesVersion }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
  return row!.version;
}

// Saves as a page holding the latest lines would.
async function save(actor: string, invoiceId: string, input: { lines: unknown[] }) {
  return saveEnteredLines(testDb, actor, invoiceId, { ...input, linesVersion: await linesVersion(invoiceId) });
}

// Decides as a page holding the latest lines would.
async function decideLine(actor: string, invoiceId: string, invoiceLineId: string, input: Record<string, unknown>) {
  return reviewInvoiceLine(testDb, actor, invoiceId, invoiceLineId, { ...input, linesVersion: await linesVersion(invoiceId) });
}

async function savedLines(invoiceId: string) {
  return testDb
    .select({ invoiceLineId: invoiceLine.invoiceLineId, description: invoiceLine.description, amount: invoiceLine.amount })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(invoiceLine.position));
}

async function snapshotOf(invoiceId: string) {
  const [chain] = await testDb
    .select({ snapshot: invoiceApprovalChain.submissionSnapshot })
    .from(invoiceApprovalChain)
    .where(eq(invoiceApprovalChain.invoiceId, invoiceId));
  return chain?.snapshot as { records: { invoice_line: Array<{ amount: string }> } } | null;
}

describe('entering an upload in review', () => {
  it('is under review from the start, given to whoever uploaded it', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice.statusCode).toBe('under_review');
    expect(detail.assignments?.reviewer?.userAccountId).toBe(reviewer);
    expect(detail.assignments?.signOff.map((person) => person.userAccountId)).toEqual([approver]);
    expect(detail.entryOpen).toBe(true);
    expect(await snapshotOf(invoiceId)).toBeNull();
  });

  it('keeps decisions on lines that did not change, and undoes them on lines that did', async () => {
    const invoiceId = await upload([
      { amount: 40, description: 'Copies' },
      { amount: 25, description: 'Parking' },
    ]);
    const [copies, parking] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await decideLine(reviewer, invoiceId, parking!.invoiceLineId, { outcome: 'approved' });

    const result = await save(reviewer, invoiceId, {
      lines: [
        { invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 40, description: 'Copies', serviceDate: '2026-02-02' },
        { invoiceLineId: parking!.invoiceLineId, lineType: 'expense', amount: 52, description: 'Parking', serviceDate: '2026-02-02' },
        { lineType: 'expense', amount: 10, description: 'Postage', serviceDate: '2026-02-02' },
      ],
    });
    expect(result.undecided).toEqual([parking!.invoiceLineId]);
    expect(result.submittedTotal).toBe('102.00');
    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.map((line) => [line.invoiceLineId, line.working?.outcomeCode ?? null])).toEqual([
      [copies!.invoiceLineId, 'approved'],
      [parking!.invoiceLineId, null],
      [expect.any(String), null],
    ]);
  });

  it('freezes the lines when the first round is finished, and not before', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });

    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshotOf(invoiceId)).toBeNull();

    await finishReview(testDb, reviewer, invoiceId, receipt);
    expect((await snapshotOf(invoiceId))?.records.invoice_line.map((line) => line.amount)).toEqual(['40.00']);
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice.statusCode).toBe('awaiting_sign_off');
    expect(detail.entryOpen).toBe(false);
    expect(detail.decidedByEnterer).toBe(true);

    // Reopened, only the decisions can change.
    await reopenReview(testDb, reviewer, invoiceId);
    await expect(
      save(reviewer, invoiceId, { lines: [{ invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 4, description: 'Copies' }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps how and when it came in as entered, by anyone on staff, so it can be finished later', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    await setEnteredReceipt(testDb, reviewer, invoiceId, { receivedVia: 'email' });
    await setEnteredReceipt(testDb, reviewer, invoiceId, { receivedOn: '2026-02-03' });
    await setEnteredReceipt(testDb, approver, invoiceId, { receivedOn: '2026-02-04' });
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId);
    const { invoice: header } = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(header).toMatchObject({ receivedOn: '2026-02-04', statusCode: 'awaiting_sign_off' });
  });

  it('needs the case number to finish', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await setEnteredCaseNumber(testDb, reviewer, invoiceId, { caseNumber: '' });
    await expect(finishReview(testDb, reviewer, invoiceId, receipt)).rejects.toThrow(ValidationError);
    await setEnteredCaseNumber(testDb, reviewer, invoiceId, { caseNumber: '26-CR-00419' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    const [row] = await testDb.select({ caseNumber: invoice.caseNumberAsTyped }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row?.caseNumber).toBe('26-CR-00419');
  });

  it('goes on with whoever it is given to', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    const other = await createStaff('reviewer', 'Reviewer Two');
    const lines = { lines: [{ invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 45, description: 'Copies', serviceDate: '2026-02-02' }] };

    await reassignReviewer(testDb, reviewer, invoiceId, { userAccountId: other });
    await save(other, invoiceId, lines);
    await decideLine(other, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, other, invoiceId, receipt);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.decidedByEnterer).toBe(false);
  });

  it('keeps a line that has a question on it', async () => {
    const invoiceId = await upload([
      { amount: 40, description: 'Copies' },
      { amount: 25, description: 'Parking' },
    ]);
    const [copies, parking] = await savedLines(invoiceId);
    await askQuestion(testDb, reviewer, invoiceId, { question: 'Which hearing?', invoiceLineId: parking!.invoiceLineId });
    await expect(
      save(reviewer, invoiceId, {
        lines: [{ invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 40, description: 'Copies', serviceDate: '2026-02-02' }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await savedLines(invoiceId)).toHaveLength(2);
    // Asked about, it is on the record and can't be discarded.
    expect(await canDiscardEntry(testDb, reviewer, invoiceId)).toBe(false);
  });

  it('treats a line id from another invoice as a new line', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const otherId = await upload([{ amount: 99, description: 'Other' }]);
    const [foreign] = await savedLines(otherId);
    await save(reviewer, invoiceId, {
      lines: [{ invoiceLineId: foreign!.invoiceLineId, lineType: 'expense', amount: 5, description: 'Stamps', serviceDate: '2026-02-02' }],
    });
    expect((await savedLines(otherId)).map((line) => line.amount)).toEqual(['99.00']);
    const [stamps] = await savedLines(invoiceId);
    expect(stamps?.invoiceLineId).not.toBe(foreign!.invoiceLineId);
  });

  it('may be discarded by whoever has it until it is frozen', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await expect(deleteUnsubmittedInvoice(testDb, noFiles, await resolvePortalActor(testDb, approver), invoiceId)).rejects.toThrow();

    await deleteUnsubmittedInvoice(testDb, noFiles, await resolvePortalActor(testDb, reviewer), invoiceId);
    expect(await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId))).toEqual([]);
  });

  it('is entered by hand by staff, and otherwise not made at all', async () => {
    const professionalId = await sender();
    const typed = { caseId: null, professionalId, submit: false, enterInReview: true, invoiceNumber: 'INV-0042', lines: [] };
    await expect(createInvoice(testDb, await resolvePortalActor(testDb, reviewer), { ...typed, submit: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await testDb.select().from(invoice)).toEqual([]);

    const { invoiceId, status } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), typed);
    expect(status).toBe('under_review');
    const events = await testDb
      .select({ code: invoiceEventTypes.code })
      .from(invoiceEvent)
      .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
      .where(eq(invoiceEvent.invoiceId, invoiceId));
    expect(events.map((event) => event.code)).toEqual(['draft_created', 'review_started']);
    // The number on the sender's invoice is kept, as an upload's is.
    const [kept] = await testDb.select().from(supportingInvoice).where(eq(supportingInvoice.invoiceId, invoiceId));
    expect(kept).toMatchObject({ invoiceNumber: 'INV-0042', documentId: null });
  });

  it('undoes a decision when anything it was made against changes, a billing code included', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    const { undecided } = await save(reviewer, invoiceId, {
      lines: [{ invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 40, description: 'Copies', serviceDate: '2026-02-02', taskCode: 'X1' }],
    });
    expect(undecided).toEqual([copies!.invoiceLineId]);
  });

  it('confirms the file on finishing, for whoever has it, undoing decisions on lines that confirming changed', async () => {
    const actor = await resolvePortalActor(testDb, reviewer);
    const professionalId = await sender();
    const { uploadReadId } = await startUploadRead(testDb, memoryStore(), actor, { fileName: 'invoice.csv', bytes: TIME_CSV });
    await extractionsSettled();
    const { invoiceId } = await createDraftFromUpload(testDb, actor, {
      uploadReadId,
      caseId: null,
      professionalId,
      caseNumber: '26-CR-00418',
      enterInReview: true,
    });
    const other = await createStaff('reviewer', 'Reviewer Two');
    await reassignReviewer(testDb, reviewer, invoiceId, { userAccountId: other });
    const [research] = await savedLines(invoiceId);
    // The file names someone no one matched, so confirming names them as new.
    await testDb
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: null, timekeeperLabel: 'Unlisted Person' })
      .where(eq(invoiceLine.invoiceLineId, research!.invoiceLineId));
    await decideLine(other, invoiceId, research!.invoiceLineId, { outcome: 'approved' });

    await expect(confirmEnteredImport(testDb, noFiles, other, invoiceId)).rejects.toBeInstanceOf(DecisionsUndoneError);
    const [confirmed] = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(confirmed).toMatchObject({ proposedTimekeeperName: 'Unlisted Person', working: null });

    // Confirmed once; finishing doesn't confirm or undo anything again.
    await decideLine(other, invoiceId, research!.invoiceLineId, { outcome: 'approved' });
    await confirmEnteredImport(testDb, noFiles, other, invoiceId);
    await finishReview(testDb, other, invoiceId, receipt);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice.statusCode).toBe('awaiting_sign_off');
  });

  it('refuses a save from a page loaded before the lines last changed, and says who changed them', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    const line = { invoiceLineId: copies!.invoiceLineId, lineType: 'expense', description: 'Copies', serviceDate: '2026-02-02' };
    const loaded = await linesVersion(invoiceId);

    // Another tab saves first.
    const { linesVersion: next } = await saveEnteredLines(testDb, reviewer, invoiceId, { lines: [{ ...line, amount: 45 }], linesVersion: loaded });
    expect(next).toBe(loaded + 1);
    await expect(
      saveEnteredLines(testDb, reviewer, invoiceId, { lines: [{ ...line, amount: 50 }], linesVersion: loaded }),
    ).rejects.toThrow('You changed these lines in another tab or window');
    expect((await savedLines(invoiceId)).map((row) => row.amount)).toEqual(['45.00']);

    // Taken over, the old page is refused, and the new reviewer sees who changed them last.
    const other = await createStaff('reviewer', 'Reviewer Two');
    await reassignReviewer(testDb, reviewer, invoiceId, { userAccountId: other });
    await expect(
      saveEnteredLines(testDb, other, invoiceId, { lines: [{ ...line, amount: 60 }], linesVersion: loaded }),
    ).rejects.toThrow('Reviewer One changed these lines');
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.linesChangedByDisplayName).toBe('Reviewer One');
    expect(detail.invoice.linesChangedAt).not.toBeNull();
  });

  it('keeps case number corrections until the lines are locked, and shows it being entered in the queue', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const other = await createStaff('reviewer', 'Reviewer Two');
    await expect(correctCaseNumber(testDb, other, invoiceId, { caseNumber: '26-CR-00999' })).rejects.toThrow('still being entered');
    const queued = (await listReviewQueue(testDb, 'open')).invoices.find((row) => row.invoiceId === invoiceId);
    expect(queued?.beingEntered).toBe(true);

    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    await correctCaseNumber(testDb, other, invoiceId, { caseNumber: '26-CR-00999' });
    expect((await listReviewQueue(testDb, 'open')).invoices.find((row) => row.invoiceId === invoiceId)?.beingEntered).toBe(false);
  });

  it('continues a reviewer’s own earlier draft in their review', async () => {
    const professionalId = await sender();
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId: null,
      professionalId,
      submit: false,
      lines: [{ lineType: 'expense', amount: 40, description: 'Copies', serviceDate: '2026-02-02' }],
    });
    await expect(enterDraftInReview(testDb, approver, invoiceId)).rejects.toThrow();
    await enterDraftInReview(testDb, reviewer, invoiceId);
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail).toMatchObject({ entryOpen: true, assignments: { reviewer: { userAccountId: reviewer } } });
  });

  it('reports only decisions it undid, not changes to undecided lines', async () => {
    const invoiceId = await upload([
      { amount: 40, description: 'Copies' },
      { amount: 25, description: 'Parking' },
    ]);
    const [copies, parking] = await savedLines(invoiceId);
    const { undecided } = await save(reviewer, invoiceId, {
      lines: [
        { invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 41, description: 'Copies', serviceDate: '2026-02-02' },
        { invoiceLineId: parking!.invoiceLineId, lineType: 'expense', amount: 25, description: 'Parking', serviceDate: '2026-02-02' },
      ],
    });
    expect(undecided).toEqual([]);
  });

  it('refuses a decision made from a page showing older lines', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    const loaded = await linesVersion(invoiceId);
    await save(reviewer, invoiceId, {
      lines: [{ invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 52, description: 'Copies', serviceDate: '2026-02-02' }],
    });
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved', linesVersion: loaded }),
    ).rejects.toThrow('You changed these lines in another tab or window');
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
  });

  it('stops entering for someone whose account was deactivated', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    await testDb.update(userAccount).set({ active: false }).where(eq(userAccount.userAccountId, reviewer));
    await expect(setEnteredCaseNumber(testDb, reviewer, invoiceId, { caseNumber: '26-CR-00999' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('keeps the id a page gave a new line, so its next save finds it', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const [copies] = await savedLines(invoiceId);
    const chosen = randomUUID();
    const copiesLine = { invoiceLineId: copies!.invoiceLineId, lineType: 'expense', amount: 40, description: 'Copies', serviceDate: '2026-02-02' };
    const stamps = { invoiceLineId: chosen, lineType: 'expense', amount: 5, description: 'Stamps', serviceDate: '2026-02-02' };
    await save(reviewer, invoiceId, { lines: [copiesLine, stamps] });
    await decideLine(reviewer, invoiceId, chosen, { outcome: 'approved' });
    await save(reviewer, invoiceId, { lines: [{ ...copiesLine, amount: 41 }, stamps] });
    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.find((line) => line.invoiceLineId === chosen)?.working?.outcomeCode).toBe('approved');
  });

  it('finishes an earlier draft filed under a case, linking its time without undoing decisions', async () => {
    const professionalId = await sender();
    const { caseId } = await createCase(
      testDb,
      { userAccountId: fixtures.staffUserAccountId },
      {
        requestId: randomUUID(),
        personId: fixtures.clientPersonId,
        participantRoleId: fixtures.clientParticipantRoleId,
        statusId: fixtures.caseStatusOpenId,
        effectiveAt: new Date('2026-01-01T12:00:00Z'),
      },
    );
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId,
      professionalId,
      submit: false,
      lines: [{ lineType: 'time', quantity: 1.5, description: 'Research', serviceDate: '2026-02-02' }],
    });
    await enterDraftInReview(testDb, reviewer, invoiceId);
    const [research] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, research!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice.statusCode).toBe('awaiting_sign_off');
    const [linked] = await testDb.select({ timeEntryId: invoiceLine.sourceTimeEntryId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    expect(linked?.timeEntryId).not.toBeNull();
  });

  it('enters an uploaded file in review in the same step that makes it', async () => {
    const actor = await resolvePortalActor(testDb, reviewer);
    const professionalId = await sender();
    const { uploadReadId } = await startUploadRead(testDb, memoryStore(), actor, { fileName: 'invoice.csv', bytes: CSV });
    await extractionsSettled();
    const { invoiceId } = await createDraftFromUpload(testDb, actor, {
      uploadReadId,
      caseId: null,
      professionalId,
      caseNumber: '26-CR-00418',
      enterInReview: true,
      ...receipt,
    });
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice.statusCode).toBe('under_review');
    expect(detail.invoice.receivedOn).toBe(receipt.receivedOn);
    expect(detail.entryOpen).toBe(true);
    expect(detail.assignments?.reviewer?.userAccountId).toBe(reviewer);
    expect(detail.fileSource?.fileName).toBe('invoice.csv');
  });

  it('is entered with no one chosen yet, its lines priced once someone is, and needs them to finish', async () => {
    const professionalId = await sender();
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId: null,
      professionalId: null,
      submit: false,
      enterInReview: true,
      caseNumber: '26-CR-00418',
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Research' }],
    });
    const [research] = await savedLines(invoiceId);
    expect(research!.amount).toBe('0.00');
    await decideLine(reviewer, invoiceId, research!.invoiceLineId, { outcome: 'approved' });
    await expect(finishReview(testDb, reviewer, invoiceId, receipt)).rejects.toMatchObject({
      fieldErrors: { professionalId: expect.any(String) },
    });

    await expect(
      setEnteredSender(testDb, reviewer, invoiceId, { professionalId, linesVersion: (await linesVersion(invoiceId)) + 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    const result = await setEnteredSender(testDb, reviewer, invoiceId, { professionalId, linesVersion: await linesVersion(invoiceId) });
    expect(result.undecided).toEqual([research!.invoiceLineId]);
    expect((await savedLines(invoiceId))[0]!.amount).toBe('200.00');

    await decideLine(reviewer, invoiceId, research!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ statusCode: 'awaiting_sign_off', professionalId, submittedTotal: '200.00' });
  });

  it('moves lines given to the earlier sender to the one chosen instead, priced at their rates', async () => {
    const first = await sender();
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId: null,
      professionalId: first,
      submit: false,
      enterInReview: true,
      caseNumber: '26-CR-00418',
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Research' }],
    });
    const chosen = await sender(150);
    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId: chosen, linesVersion: await linesVersion(invoiceId) });
    const [line] = await testDb
      .select({ timekeeper: invoiceLine.timekeeperProfessionalId, amount: invoiceLine.amount })
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, invoiceId));
    expect(line).toEqual({ timekeeper: chosen, amount: '300.00' });
  });

  it('keeps the billing period and invoice number entered beside the lines', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    const details = { periodStart: '2026-02-01', periodEnd: '2026-02-28', invoiceNumber: 'SYN-0001' };
    await setEnteredDetails(testDb, reviewer, invoiceId, details);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice).toMatchObject(details);
    await expect(
      setEnteredDetails(testDb, reviewer, invoiceId, { ...details, periodEnd: null }),
    ).rejects.toBeInstanceOf(ValidationError);

    await setEnteredDetails(testDb, approver, invoiceId, { ...details, invoiceNumber: null });
    expect(await testDb.select().from(supportingInvoice).where(eq(supportingInvoice.invoiceId, invoiceId))).toEqual([]);
  });
});

describe('whom an entry is from', () => {
  // Someone with no role, so their time can't be priced.
  async function withoutRole() {
    const email = `no-role-${randomUUID()}@example.com`;
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Sample Unrated', email, active: true }).returning();
    return ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  }

  it('lets a reviewer give a sender with no role theirs, pricing the lines, but never change one', async () => {
    const professionalId = await withoutRole();
    const { professionalKindId } = await createKind(testDb, { displayName: `Synthetic kind ${randomUUID()}` });
    await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 120, effectiveFrom: '2025-01-01' });
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId: null,
      professionalId,
      submit: false,
      enterInReview: true,
      caseNumber: '26-CR-00418',
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Research' }],
    });
    expect((await savedLines(invoiceId))[0]!.amount).toBe('0.00');

    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId, professionalKindId, linesVersion: await linesVersion(invoiceId) });
    expect((await savedLines(invoiceId))[0]!.amount).toBe('240.00');
    await expect(
      setEnteredSender(testDb, reviewer, invoiceId, { professionalId, professionalKindId, linesVersion: await linesVersion(invoiceId) }),
    ).rejects.toMatchObject({ fieldErrors: { professionalKindId: expect.any(String) } });
  });

  it('gives a role for any staff member, but not a deactivated one', async () => {
    const professionalId = await withoutRole();
    const { professionalKindId } = await createKind(testDb, { displayName: `Synthetic kind ${randomUUID()}` });
    const staffMember = await createStaff('staff');
    const actor = await resolvePortalActor(testDb, staffMember);
    const { invoiceId } = await createInvoice(testDb, actor, { caseId: null, professionalId: null, submit: false, lines: [] });
    await testDb.update(userAccount).set({ active: false }).where(eq(userAccount.userAccountId, staffMember));
    await expect(setDraftSender(testDb, actor, invoiceId, { professionalId, professionalKindId })).rejects.toBeInstanceOf(ForbiddenError);
    await testDb.update(userAccount).set({ active: true }).where(eq(userAccount.userAccountId, staffMember));
    await setDraftSender(testDb, actor, invoiceId, { professionalId, professionalKindId });
  });

  it('checks the file again for duplicates when whom it is from changes', async () => {
    const actor = await resolvePortalActor(testDb, reviewer);
    const [first, second] = [await sender(), await sender()];
    const uploadAs = async (professionalId: string | null) => {
      const { uploadReadId } = await startUploadRead(testDb, memoryStore(), actor, { fileName: 'invoice.csv', bytes: CSV });
      await extractionsSettled();
      return (await createDraftFromUpload(testDb, actor, { uploadReadId, caseId: null, professionalId, caseNumber: '26-CR-00418', enterInReview: true }))
        .invoiceId;
    };
    const duplicates = async (invoiceId: string) =>
      (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.fileSource!.warnings.filter((warning) => warning.code === 'duplicate_file');

    await uploadAs(first);
    const invoiceId = await uploadAs(null);
    expect(await duplicates(invoiceId)).toEqual([]);
    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId: first, linesVersion: await linesVersion(invoiceId) });
    expect(await duplicates(invoiceId)).toHaveLength(1);
    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId: second, linesVersion: await linesVersion(invoiceId) });
    expect(await duplicates(invoiceId)).toEqual([]);
  });
});

describe('removing someone added by mistake', () => {
  async function added() {
    const { professionalKindId } = await createKind(testDb, { displayName: `Synthetic kind ${randomUUID()}` });
    await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 100, effectiveFrom: '2025-01-01' });
    return (await addProfessional(testDb, reviewer, { displayName: 'Sample Mistake', professionalKindId })).professionalId;
  }

  it('leaves an unfinished entry with no one chosen, its decisions undone, and records who removed them', async () => {
    const professionalId = await added();
    const { invoiceId } = await createInvoice(testDb, await resolvePortalActor(testDb, reviewer), {
      caseId: null,
      professionalId,
      submit: false,
      enterInReview: true,
      caseNumber: '26-CR-00418',
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Research' }],
    });
    const [research] = await savedLines(invoiceId);
    expect(research!.amount).toBe('200.00');
    await decideLine(reviewer, invoiceId, research!.invoiceLineId, { outcome: 'approved' });
    const version = await linesVersion(invoiceId);

    await expect(removeProfessional(testDb, approver, professionalId)).resolves.toMatchObject({ releasedInvoiceIds: [invoiceId] });
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ professionalId: null, linesVersion: version + 1 });
    expect(detail.lines[0]).toMatchObject({ amount: '0.00', timekeeperProfessionalId: null, working: null });
    const events = await testDb.select().from(auditEvent).where(eq(auditEvent.entityId, professionalId));
    expect(events.find((event) => event.eventType === 'professional_removed')).toMatchObject({ actorUserAccountId: approver });
  });

  it('keeps anyone on a sent invoice, or who has signed in', async () => {
    const professionalId = await added();
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId, linesVersion: await linesVersion(invoiceId) });
    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    await expect(removeProfessional(testDb, approver, professionalId)).rejects.toBeInstanceOf(ConflictError);
    await expect(removeProfessional(testDb, approver, await sender())).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets whoever added them correct their name and email, rather than adding them again, until the round is finished', async () => {
    const professionalId = await added();
    const invoiceId = await upload([{ amount: 40, description: 'Copies' }]);
    await setEnteredSender(testDb, reviewer, invoiceId, { professionalId, linesVersion: await linesVersion(invoiceId) });

    await correctNewProfessional(testDb, reviewer, professionalId, { displayName: 'Sample Corrected', email: 'Corrected@Example.com' });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice.professionalDisplayName).toBe('Sample Corrected');
    const [row] = await testDb
      .select({ email: person.email })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(eq(professional.professionalId, professionalId));
    expect(row?.email).toBe('corrected@example.com');
    await expect(correctNewProfessional(testDb, approver, professionalId, { displayName: 'Other' })).rejects.toBeInstanceOf(ForbiddenError);

    const [copies] = await savedLines(invoiceId);
    await decideLine(reviewer, invoiceId, copies!.invoiceLineId, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId, receipt);
    await expect(correctNewProfessional(testDb, reviewer, professionalId, { displayName: 'Too Late' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('keeps the first and last name of someone added with them, beside the whole name', async () => {
    const { professionalKindId } = await createKind(testDb, { displayName: `Synthetic kind ${randomUUID()}` });
    const { professionalId } = await addProfessional(testDb, reviewer, {
      displayName: 'Sample Parted',
      givenName: 'Sample',
      familyName: 'Parted',
      professionalKindId,
    });
    const [row] = await testDb
      .select({ displayName: person.displayName, givenName: person.givenName, familyName: person.familyName })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(eq(professional.professionalId, professionalId));
    expect(row).toEqual({ displayName: 'Sample Parted', givenName: 'Sample', familyName: 'Parted' });
  });

  it('keeps anyone on an invoice that was sent, even after it was recalled to a draft', async () => {
    const professionalId = await added();
    const actor = await resolvePortalActor(testDb, await createStaff('staff'));
    const { invoiceId } = await createInvoice(testDb, actor, {
      caseId: null,
      professionalId,
      caseNumber: '26-CR-00418',
      ...receipt,
      lines: [{ lineType: 'expense', serviceDate: '2026-02-02', amount: 40, description: 'Copies' }],
    });
    await recallInvoice(testDb, actor, invoiceId);
    await expect(removeProfessional(testDb, approver, professionalId)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('a draft filed by person', () => {
  it('is filed under whom it is chosen to be from, with its period and number, as it is checked', async () => {
    const actor = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const professionalId = await sender();
    const { invoiceId } = await createInvoice(testDb, actor, {
      caseId: null,
      professionalId: null,
      submit: false,
      lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 2, description: 'Research' }],
    });
    await setDraftSender(testDb, actor, invoiceId, { professionalId });
    await setDraftDetails(testDb, actor, invoiceId, { periodStart: '2026-02-01', periodEnd: '2026-02-28', invoiceNumber: 'SYN-0002' });
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ professionalId, submittedTotal: '200.00', periodEnd: '2026-02-28', invoiceNumber: 'SYN-0002' });
  });
});

describe('who staff email about an upload', () => {
  it('is whoever billed it, not the staff member who entered it', async () => {
    const invoiceId = await upload([{ amount: 40, description: 'Filing fee' }]);
    const { invoice: header } = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    const [billedBy] = await testDb
      .select({ email: userAccount.email })
      .from(professional)
      .innerJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
      .where(eq(professional.professionalId, header.professionalId!));
    expect(await loadSenderEmail(testDb, header)).toBe(billedBy!.email);
  });
});
