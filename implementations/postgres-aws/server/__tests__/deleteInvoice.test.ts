import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { InvoiceStateError, recallInvoice, submitInvoice, updateDraftInvoice, withdrawInvoice } from '../src/billing/invoiceLifecycle';
import { InvoiceNotFoundError } from '../src/billing/reviewInvoiceLine';
import { deleteUnsubmittedInvoice, isInvoiceDeletableBy } from '../src/billing/deleteInvoice';
import { getReferenceId } from '../src/db/referenceLookups';
import { listPortalInvoices } from '../src/portal/listPortalInvoices';
import { confirmInvoiceImport, uploadInvoiceFile } from '../src/imports/invoiceImports';
import type { DocumentStore } from '../src/imports/documentStore';
import {
  caseAssignment,
  document,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  invoiceApprovalStepTypes,
  invoiceEvent,
  invoiceImport,
  invoiceLine,
  timeEntry,
  userAccount,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

function memoryStore(): DocumentStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async (bytes) => {
      const reference = `memory:${randomUUID()}`;
      files.set(reference, bytes);
      return reference;
    },
    get: async (reference) => files.get(reference),
    delete: async (reference) => {
      files.delete(reference);
    },
  };
}

async function setup(): Promise<{ actor: PortalActor; caseId: string }> {
  const email = `${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
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

const exists = async (invoiceId: string) =>
  (await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId))).length > 0;

describe('deleting invoices that were never submitted', () => {
  it('deletes a draft with its lines and events, and a withdrawn one too', async () => {
    const { actor, caseId } = await setup();
    const store = memoryStore();
    const draft = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ amount: 10 }] });
    await deleteUnsubmittedInvoice(testDb, store, actor, draft.invoiceId);
    expect(await exists(draft.invoiceId)).toBe(false);
    expect(await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, draft.invoiceId))).toHaveLength(0);
    expect(await testDb.select().from(invoiceEvent).where(eq(invoiceEvent.invoiceId, draft.invoiceId))).toHaveLength(0);

    const withdrawn = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ amount: 10 }] });
    await withdrawInvoice(testDb, actor, withdrawn.invoiceId);
    await deleteUnsubmittedInvoice(testDb, store, actor, withdrawn.invoiceId);
    expect(await exists(withdrawn.invoiceId)).toBe(false);
  });

  it('refuses a submitted invoice, but deletes one recalled before review with its submission history', async () => {
    const { actor, caseId } = await setup();
    const store = memoryStore();
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 10 }] });
    await expect(deleteUnsubmittedInvoice(testDb, store, actor, invoiceId)).rejects.toThrow(InvoiceStateError);
    expect(await isInvoiceDeletableBy(testDb, actor.userAccountId, invoiceId)).toBe(false);

    await recallInvoice(testDb, actor, invoiceId);
    await withdrawInvoice(testDb, actor, invoiceId);
    expect(await isInvoiceDeletableBy(testDb, actor.userAccountId, invoiceId)).toBe(true);
    await deleteUnsubmittedInvoice(testDb, store, actor, invoiceId);
    expect(await exists(invoiceId)).toBe(false);
    expect(await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId))).toHaveLength(0);
  });

  it('keeps an invoice once a review decision is recorded', async () => {
    const { actor, caseId } = await setup();
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ amount: 10 }] });
    // A decision on an earlier attempt; the workflow itself only allows
    // recall before review, so this guards the data, not a reachable flow.
    const [chain] = await testDb
      .insert(invoiceApprovalChain)
      .values({ invoiceId, createdByUserAccountId: actor.userAccountId, createdAt: new Date(), supersededAt: new Date() })
      .returning();
    const [line] = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    await testDb.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chain!.invoiceApprovalChainId,
      sequenceNumber: 1,
      stepTypeId: await getReferenceId(testDb, invoiceApprovalStepTypes, 'line_review'),
      invoiceLineId: line!.invoiceLineId,
      outcomeId: await getReferenceId(testDb, invoiceApprovalOutcomes, 'approved'),
      decidedByUserAccountId: fixtures.staffUserAccountId,
      decidedAt: new Date(),
      approvedAmount: '10.00',
    });
    expect(await isInvoiceDeletableBy(testDb, actor.userAccountId, invoiceId)).toBe(false);
    await expect(deleteUnsubmittedInvoice(testDb, memoryStore(), actor, invoiceId)).rejects.toThrow(/review decisions/);
  });

  it("treats another user's invoice as not found", async () => {
    const owner = await setup();
    const other = await setup();
    const { invoiceId } = await createInvoice(testDb, owner.actor, { caseId: owner.caseId, submit: false, lines: [{ amount: 10 }] });
    await expect(deleteUnsubmittedInvoice(testDb, memoryStore(), other.actor, invoiceId)).rejects.toThrow(InvoiceNotFoundError);
  });

  it('deletes an imported draft with its import record, document and file', async () => {
    const { actor, caseId } = await setup();
    const store = memoryStore();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'a.csv', bytes: Buffer.from('amount\n10\n') });
    expect(store.files.size).toBe(1);

    await deleteUnsubmittedInvoice(testDb, store, actor, uploaded.invoiceId as string);
    expect(store.files.size).toBe(0);
    expect(await testDb.select().from(invoiceImport)).toHaveLength(0);
    expect(await testDb.select().from(document)).toHaveLength(0);
  });

  it('deletes time an imported invoice created on submission, after a recall', async () => {
    const { actor, caseId } = await setup();
    const store = memoryStore();
    const uploaded = await uploadInvoiceFile(testDb, store, actor, { caseId, fileName: 'a.csv', bytes: Buffer.from('amount\n10\n') });
    const invoiceId = uploaded.invoiceId as string;
    await updateDraftInvoice(testDb, actor, invoiceId, {
      lines: [{ amount: 150, lineType: 'time', serviceDate: '2026-01-10', quantity: 1.5, timekeeperProfessionalId: actor.professionalId! }],
    });
    await confirmInvoiceImport(testDb, store, actor, uploaded.invoiceImportId);
    await submitInvoice(testDb, actor, invoiceId);
    expect(await testDb.select().from(timeEntry).where(eq(timeEntry.sourceInvoiceImportId, uploaded.invoiceImportId))).toHaveLength(1);

    await recallInvoice(testDb, actor, invoiceId);
    await deleteUnsubmittedInvoice(testDb, store, actor, invoiceId);
    expect(await exists(invoiceId)).toBe(false);
    expect(await testDb.select().from(timeEntry)).toHaveLength(0);
  });
});

describe('the portal invoice list', () => {
  it('says whether each can be deleted, and when a recalled one was submitted', async () => {
    const { actor, caseId } = await setup();
    const draft = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ amount: 10 }] });
    const recalled = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 10 }] });
    await recallInvoice(testDb, actor, recalled.invoiceId);

    const rows = await listPortalInvoices(testDb, actor, caseId);
    const byId = new Map(rows.map((row) => [row.invoiceId, row]));
    expect(byId.get(draft.invoiceId)).toMatchObject({ deletable: true, lastSubmittedAt: null });
    expect(byId.get(recalled.invoiceId)).toMatchObject({ deletable: true, statusCode: 'draft', submittedAt: null });
    expect(byId.get(recalled.invoiceId)?.lastSubmittedAt).not.toBeNull();

    const other = await setup();
    expect((await listPortalInvoices(testDb, other.actor)).every((row) => !row.deletable)).toBe(true);
  });
});
