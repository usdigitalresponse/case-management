// Settings, Edit data (model/rules.yaml correct_case_records): an
// administrator fixes a case added by mistake - moving its requests to the
// same case recorded twice, correcting it, or taking its requests off it. The
// preview says exactly what changes; each fix records every value it changes,
// so it can be undone.
/* eslint-disable no-await-in-loop -- a transaction runs one query at a time, and the changes' order is undone in reverse */
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { firstRow } from '../db/rowHelpers';
import {
  caseAssignment,
  caseCorrection,
  caseCorrectionChange,
  caseLifecycleEvent,
  caseLifecycleEventTypes,
  caseParticipant,
  caseStatuses,
  caseTable,
  county,
  invoice,
  invoiceStatuses,
  person,
  preauthorization,
  preauthorizationRequest,
  professional,
  role,
  userAccount,
} from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import { cleanCaseNumber } from '../billing/caseNumbers';
import { caseStepMatches } from './caseStep';
import {
  CLOSED_CASE_STATUS_CODE,
  CLOSING_EVENT_TYPE_CODE,
  nextLifecycleSequence,
  OPEN_CASE_STATUS_CODE,
  REOPENING_EVENT_TYPE_CODE,
} from './closeCase';

type PgType = 'uuid' | 'text' | 'date' | 'boolean' | 'timestamptz';

interface Column {
  table: string;
  id: string;
  column: string;
  type: PgType;
}

const column = (table: string, name: string, type: PgType, id = `${table}_id`): Column => ({ table, id, column: name, type });

// Every column a fix may change, by name, so an undo never writes elsewhere.
const CHANGEABLE = new Map<string, Column>(
  [
    column('invoice', 'case_id', 'uuid'),
    column('invoice', 'case_choice', 'text'),
    column('invoice', 'county_id', 'uuid'),
    column('invoice', 'chosen_case_id', 'uuid'),
    column('invoice_line', 'case_id', 'uuid'),
    column('invoice_import', 'case_id', 'uuid'),
    column('case_rate', 'case_id', 'uuid'),
    column('document_link', 'case_id', 'uuid'),
    column('preauthorization', 'case_id', 'uuid'),
    column('preauthorization_request', 'case_id', 'uuid'),
    column('preauthorization_request', 'not_for_case', 'boolean'),
    column('preauthorization_request', 'county_id', 'uuid'),
    column('case_assignment', 'case_id', 'uuid'),
    column('case_assignment', 'ended_at', 'timestamptz'),
    column('case', 'external_reference', 'text'),
    column('case', 'county_id', 'uuid'),
    column('case', 'client_id', 'uuid'),
    column('case', 'status_id', 'uuid'),
    column('case', 'closed_on', 'date'),
    column('case', 'closed_as_mistake', 'boolean'),
    column('person', 'display_name', 'text'),
    column('case_participant', 'ended_at', 'timestamptz'),
  ].map((target) => [`${target.table}.${target.column}`, target]),
);

interface Change {
  table: string;
  column: string;
  rowId: string;
  from: string | null;
  to: string | null;
}

const cast = (value: string | null, type: PgType) => (type === 'text' ? sql`${value}` : sql`cast(${value} as ${sql.raw(type)})`);

function target(change: { table: string; column: string }): Column {
  const found = CHANGEABLE.get(`${change.table}.${change.column}`);
  if (!found) throw new Error(`Unknown case correction change ${change.table}.${change.column}`);
  return found;
}

async function rowsWhere(tx: DatabaseOrTransaction, table: string, id: string, where: ReturnType<typeof sql>) {
  const result = await tx.execute<{ id: string }>(sql`select ${sql.identifier(id)} as id from ${sql.identifier(table)} where ${where}`);
  return result.rows.map((row) => row.id);
}

// The rows of a table pointing at the case, each to change from it to another value.
async function moveAll(tx: DatabaseOrTransaction, table: string, columnName: string, from: string, to: string | null, extra = sql`true`): Promise<Change[]> {
  const { id } = target({ table, column: columnName });
  const ids = await rowsWhere(tx, table, id, sql`${sql.identifier(columnName)} = ${from} and ${extra}`);
  return ids.map((rowId) => ({ table, column: columnName, rowId, from, to }));
}

const fixSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('same_case'),
    caseId: z.uuid(),
    keptCaseId: z.uuid('Choose the case to keep.'),
    // Where both cases have one for a provider: keep the one moving ('moved') or the kept case's ('kept').
    keepPreauthorizations: z.record(z.uuid(), z.enum(['moved', 'kept'])).default({}),
  }),
  z.object({
    kind: z.literal('corrected'),
    caseId: z.uuid(),
    caseNumber: z.string().trim().max(100).optional(),
    countyId: z.uuid().optional(),
    clientName: z.string().trim().max(200).optional(),
  }),
  z.object({ kind: z.literal('not_for_case'), caseId: z.uuid() }),
]);

type FixInput = z.infer<typeof fixSchema>;

function parseFix(rawInput: unknown): FixInput {
  const parsed = fixSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  return parsed.data;
}

async function loadCase(db: DatabaseOrTransaction, caseId: string) {
  const [row] = await db.select().from(caseTable).where(eq(caseTable.caseId, caseId));
  if (!row) throw new NotFoundError('That case is not in the system.');
  return row;
}

// Both cases' pre-authorizations for the same provider.
async function preauthorizationConflicts(db: DatabaseOrTransaction, caseId: string, keptCaseId: string) {
  const rows = await db
    .select({ preauthorizationId: preauthorization.preauthorizationId, caseId: preauthorization.caseId, professionalId: preauthorization.professionalId })
    .from(preauthorization)
    .where(and(inArray(preauthorization.caseId, [caseId, keptCaseId]), isNotNull(preauthorization.professionalId)));
  const moving = rows.filter((row) => row.caseId === caseId);
  return moving.flatMap((row) => {
    const kept = rows.find((other) => other.caseId === keptCaseId && other.professionalId === row.professionalId);
    return kept ? [{ professionalId: row.professionalId!, moving: row.preauthorizationId, kept: kept.preauthorizationId }] : [];
  });
}

// What closing a case as added by mistake changes on it.
async function closingChanges(tx: DatabaseOrTransaction, row: typeof caseTable.$inferSelect, now: Date): Promise<Change[]> {
  const closedStatusId = await getReferenceId(tx, caseStatuses, CLOSED_CASE_STATUS_CODE);
  const open = await tx
    .select({ id: caseAssignment.caseAssignmentId })
    .from(caseAssignment)
    .where(and(eq(caseAssignment.caseId, row.caseId), isNull(caseAssignment.endedAt)));
  return [
    { table: 'case', column: 'status_id', rowId: row.caseId, from: row.statusId, to: closedStatusId },
    { table: 'case', column: 'closed_on', rowId: row.caseId, from: row.closedOn, to: row.closedOn ?? calendarDateInReportingTimeZone(now) },
    { table: 'case', column: 'closed_as_mistake', rowId: row.caseId, from: 'false', to: 'true' },
    ...open.map((assignment) => ({ table: 'case_assignment', column: 'ended_at', rowId: assignment.id, from: null, to: now.toISOString() })),
  ];
}

async function plan(tx: DatabaseOrTransaction, input: FixInput, now: Date): Promise<Change[]> {
  const row = await loadCase(tx, input.caseId);
  if (row.closedAsMistake) throw new ConflictError('already_fixed', 'This case was already closed as added by mistake.');
  const caseId = row.caseId;
  if (input.kind === 'corrected') {
    const changes: Change[] = [];
    const caseNumber = input.caseNumber === undefined ? row.externalReference : cleanCaseNumber(input.caseNumber);
    const countyId = input.countyId ?? row.countyId;
    if (caseNumber !== row.externalReference || countyId !== row.countyId) {
      const { exact } = await caseStepMatches(tx, caseNumber, countyId);
      if (exact && exact.caseId !== caseId) {
        throw new ValidationError({ caseNumber: `Case ${exact.caseNumber ?? caseNumber} is already in ${exact.countyDisplayName ?? 'that county'}. Move its invoices there instead.` });
      }
      changes.push({ table: 'case', column: 'external_reference', rowId: caseId, from: row.externalReference, to: caseNumber });
      changes.push({ table: 'case', column: 'county_id', rowId: caseId, from: row.countyId, to: countyId });
    }
    if (input.clientName && row.clientId) {
      const [client] = await tx.select({ displayName: person.displayName }).from(person).where(eq(person.personId, row.clientId));
      if (client && client.displayName !== input.clientName) {
        changes.push({ table: 'person', column: 'display_name', rowId: row.clientId, from: client.displayName, to: input.clientName });
      }
    }
    return changes;
  }
  if (input.kind === 'same_case') {
    if (input.keptCaseId === caseId) throw new ValidationError({ keptCaseId: 'Choose another case to keep.' });
    const kept = await loadCase(tx, input.keptCaseId);
    if (kept.closedAsMistake) throw new ValidationError({ keptCaseId: 'Choose a listed case to keep.' });
    if (kept.countyId && row.countyId && kept.countyId !== row.countyId) {
      throw new ValidationError({ keptCaseId: 'A case in another county is another case. Correct this case’s county first.' });
    }
    const conflicts = await preauthorizationConflicts(tx, caseId, kept.caseId);
    const unchosen = conflicts.filter((conflict) => !input.keepPreauthorizations[conflict.professionalId]);
    if (unchosen.length > 0) {
      throw new ValidationError({ keepPreauthorizations: 'Both cases have a pre-authorization for the same provider. Choose which to keep.' });
    }
    const stays = new Set(conflicts.filter((conflict) => input.keepPreauthorizations[conflict.professionalId] === 'kept').map((conflict) => conflict.moving));
    const swapsOut = conflicts.filter((conflict) => input.keepPreauthorizations[conflict.professionalId] === 'moved').map((conflict) => conflict.kept);
    const onKept = await tx
      .select({ professionalId: caseAssignment.professionalId })
      .from(caseAssignment)
      .where(and(eq(caseAssignment.caseId, kept.caseId), isNull(caseAssignment.endedAt)));
    const keptProfessionals = onKept.map((assignment) => assignment.professionalId);
    const moved = [
      ...(await moveAll(tx, 'invoice', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'invoice', 'chosen_case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'invoice_line', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'invoice_import', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'case_rate', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'document_link', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'preauthorization_request', 'case_id', caseId, kept.caseId)),
      ...(await moveAll(tx, 'preauthorization', 'case_id', caseId, kept.caseId)).filter((change) => !stays.has(change.rowId)),
      ...swapsOut.map((preauthorizationId) => ({ table: 'preauthorization', column: 'case_id', rowId: preauthorizationId, from: kept.caseId, to: caseId })),
      ...(await moveAll(
        tx,
        'case_assignment',
        'case_id',
        caseId,
        kept.caseId,
        keptProfessionals.length > 0
          ? sql`ended_at is null and professional_id <> all(${sql`${`{${keptProfessionals.join(',')}}`}::uuid[]`})`
          : sql`ended_at is null`,
      )),
    ];
    const movedAssignments = new Set(moved.filter((change) => change.table === 'case_assignment').map((change) => change.rowId));
    const closing = (await closingChanges(tx, row, now)).filter((change) => !movedAssignments.has(change.rowId));
    return [...moved, ...closing];
  }
  // Not for one case: its requests keep their own county, or take the case's.
  const invoices = await tx.select({ invoiceId: invoice.invoiceId, countyId: invoice.countyId, caseChoice: invoice.caseChoice }).from(invoice).where(eq(invoice.caseId, caseId));
  const requests = await tx
    .select({ id: preauthorizationRequest.preauthorizationRequestId })
    .from(preauthorizationRequest)
    .where(eq(preauthorizationRequest.caseId, caseId));
  return [
    ...invoices.flatMap((one) => [
      { table: 'invoice', column: 'case_id', rowId: one.invoiceId, from: caseId, to: null },
      { table: 'invoice', column: 'case_choice', rowId: one.invoiceId, from: one.caseChoice, to: 'none' },
      ...(one.countyId ? [] : [{ table: 'invoice', column: 'county_id', rowId: one.invoiceId, from: null, to: row.countyId }]),
    ]),
    ...(await moveAll(tx, 'invoice', 'chosen_case_id', caseId, null)),
    ...(await moveAll(tx, 'invoice_line', 'case_id', caseId, null)),
    ...(await moveAll(tx, 'invoice_import', 'case_id', caseId, null)),
    ...requests.flatMap((request) => [
      { table: 'preauthorization_request', column: 'case_id', rowId: request.id, from: caseId, to: null },
      { table: 'preauthorization_request', column: 'not_for_case', rowId: request.id, from: 'false', to: 'true' },
      { table: 'preauthorization_request', column: 'county_id', rowId: request.id, from: null, to: row.countyId },
    ]),
    ...(await closingChanges(tx, row, now)),
  ];
}

async function apply(tx: Transaction, caseCorrectionId: string, changes: Change[]) {
  for (const change of changes) {
    const { table, id, column: name, type } = target(change);
    await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(name)} = ${cast(change.to, type)} where ${sql.identifier(id)} = ${change.rowId}`);
  }
  if (changes.length > 0) {
    await tx.insert(caseCorrectionChange).values(
      changes.map((change, position) => ({
        caseCorrectionId,
        position,
        tableName: change.table,
        columnName: change.column,
        rowId: change.rowId,
        fromValue: change.from,
        toValue: change.to,
      })),
    );
  }
}

async function recordLifecycle(tx: Transaction, actorUserAccountId: string, caseId: string, closing: boolean, now: Date) {
  const statusId = await getReferenceId(tx, caseStatuses, closing ? CLOSED_CASE_STATUS_CODE : OPEN_CASE_STATUS_CODE);
  const eventTypeId = await getReferenceId(tx, caseLifecycleEventTypes, closing ? CLOSING_EVENT_TYPE_CODE : REOPENING_EVENT_TYPE_CODE);
  await tx.insert(caseLifecycleEvent).values({
    caseId,
    sequenceNumber: await nextLifecycleSequence(tx, caseId),
    eventTypeId,
    resultingStatusId: statusId,
    effectiveAt: now,
    recordedAt: now,
    actorUserAccountId,
    reasonDetail: closing ? 'Added by mistake' : 'Fix undone',
  });
}

const closes = (input: FixInput) => input.kind !== 'corrected';

// A client named where the case has none: a new person in the client role.
async function addClient(tx: Transaction, caseId: string, clientName: string, now: Date): Promise<Change[]> {
  const [clientRole] = await tx
    .select({ roleId: role.roleId })
    .from(role)
    .where(and(eq(role.roleContext, 'case_participant'), eq(role.displayName, 'Client'), eq(role.active, true)));
  const added = firstRow(await tx.insert(person).values({ displayName: clientName }).returning({ personId: person.personId }));
  if (!clientRole) return [{ table: 'case', column: 'client_id', rowId: caseId, from: null, to: added.personId }];
  const participant = firstRow(
    await tx
      .insert(caseParticipant)
      .values({ caseId, personId: added.personId, participantRoleId: clientRole.roleId, startedAt: now })
      .returning({ id: caseParticipant.caseParticipantId }),
  );
  // Undoing ends the role rather than deleting it (undoCaseFix).
  return [
    { table: 'case', column: 'client_id', rowId: caseId, from: null, to: added.personId },
    { table: 'case_participant', column: 'ended_at', rowId: participant.id, from: null, to: null },
  ];
}

// Administrators only (the route checks). All or none.
export async function fixCase(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const input = parseFix(rawInput);
  return db.transaction(async (tx) => {
    await tx.select({ id: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, input.caseId)).for('update');
    const now = new Date();
    const changes = await plan(tx, input, now);
    const correction = firstRow(
      await tx
        .insert(caseCorrection)
        .values({
          caseId: input.caseId,
          kind: input.kind,
          keptCaseId: input.kind === 'same_case' ? input.keptCaseId : null,
          correctedByUserAccountId: actorUserAccountId,
          correctedAt: now,
        })
        .returning({ id: caseCorrection.caseCorrectionId }),
    );
    const row = await loadCase(tx, input.caseId);
    const clientChanges = input.kind === 'corrected' && input.clientName && !row.clientId ? await addClient(tx, input.caseId, input.clientName, now) : [];
    changes.push(...clientChanges);
    await apply(tx, correction.id, changes);
    if (closes(input)) {
      await recordLifecycle(tx, actorUserAccountId, input.caseId, true, now);
    }
    return { caseCorrectionId: correction.id, changed: changes.length };
  });
}

// Puts back each value still as the fix left it; anything changed since stays.
export async function undoCaseFix(db: Database, actorUserAccountId: string, caseCorrectionId: string) {
  if (!z.uuid().safeParse(caseCorrectionId).success) throw new NotFoundError('That fix is not in the system.');
  return db.transaction(async (tx) => {
    const [fix] = await tx.select().from(caseCorrection).where(eq(caseCorrection.caseCorrectionId, caseCorrectionId)).for('update');
    if (!fix) throw new NotFoundError('That fix is not in the system.');
    if (fix.undoneAt) throw new ConflictError('already_undone', 'This fix has already been undone.');
    const changes = await tx
      .select()
      .from(caseCorrectionChange)
      .where(eq(caseCorrectionChange.caseCorrectionId, caseCorrectionId))
      .orderBy(desc(caseCorrectionChange.position));
    const now = new Date();
    let restored = 0;
    for (const change of changes) {
      const { table, id, column: name, type } = target({ table: change.tableName, column: change.columnName });
      if (table === 'case_participant' && name === 'ended_at') {
        // A client added by the fix: their role ends now.
        const result = await tx.execute(sql`update case_participant set ended_at = ${now.toISOString()}::timestamptz where case_participant_id = ${change.rowId} and ended_at is null`);
        restored += result.rowCount ?? 0;
        continue;
      }
      const result = await tx.execute(
        sql`update ${sql.identifier(table)} set ${sql.identifier(name)} = ${cast(change.fromValue, type)}
          where ${sql.identifier(id)} = ${change.rowId} and ${sql.identifier(name)} is not distinct from ${cast(change.toValue, type)}`,
      );
      restored += result.rowCount ?? 0;
    }
    if (fix.kind !== 'corrected') {
      await recordLifecycle(tx, actorUserAccountId, fix.caseId, false, now);
    }
    await tx.update(caseCorrection).set({ undoneByUserAccountId: actorUserAccountId, undoneAt: now }).where(eq(caseCorrection.caseCorrectionId, caseCorrectionId));
    return { restored, leftAsIs: changes.length - restored };
  });
}

// --- reading ---------------------------------------------------------------

const opener = alias(userAccount, 'opener');
const keptCase = alias(caseTable, 'kept_case');

export interface AddedCase {
  caseId: string;
  caseNumber: string | null;
  countyId: string | null;
  countyDisplayName: string | null;
  clientDisplayName: string | null;
  addedAt: Date;
  addedByDisplayName: string | null;
  addedFrom: 'invoice' | 'preauthorization_request';
  invoices: number;
  preauthorizationRequests: number;
  similar: Array<{ caseId: string; caseNumber: string | null; clientDisplayName: string | null }>;
}

// Cases added from requests, newest first; `similar` narrows to those with a close number in their county.
export async function listAddedCases(db: DatabaseOrTransaction, options: { similarOnly?: boolean; limit?: number } = {}): Promise<AddedCase[]> {
  const rows = await db
    .select({
      caseId: caseTable.caseId,
      caseNumber: caseTable.externalReference,
      countyId: caseTable.countyId,
      countyDisplayName: county.displayName,
      clientDisplayName: person.displayName,
      addedAt: caseLifecycleEvent.recordedAt,
      addedByDisplayName: opener.displayName,
      fromInvoice: caseTable.addedFromInvoiceId,
      invoices: sql<number>`(select count(*)::int from ${invoice} where ${invoice.caseId} = ${caseTable.caseId})`,
      preauthorizationRequests: sql<number>`(select count(*)::int from ${preauthorizationRequest} where ${preauthorizationRequest.caseId} = ${caseTable.caseId})`,
    })
    .from(caseTable)
    .innerJoin(caseLifecycleEvent, and(eq(caseLifecycleEvent.caseId, caseTable.caseId), eq(caseLifecycleEvent.sequenceNumber, 1)))
    .leftJoin(opener, eq(caseLifecycleEvent.actorUserAccountId, opener.userAccountId))
    .leftJoin(county, eq(caseTable.countyId, county.countyId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(
      and(
        eq(caseTable.closedAsMistake, false),
        sql`(${caseTable.addedFromInvoiceId} is not null or ${caseTable.addedFromPreauthorizationRequestId} is not null)`,
      ),
    )
    .orderBy(desc(caseLifecycleEvent.recordedAt))
    .limit(options.limit ?? 100);
  const listed = await Promise.all(
    rows.map(async (row) => {
      const { exact, similar } = await caseStepMatches(db, row.caseNumber, row.countyId);
      const others = [...(exact ? [exact] : []), ...similar].filter((other) => other.caseId !== row.caseId);
      const { fromInvoice, ...rest } = row;
      return {
        ...rest,
        addedFrom: fromInvoice ? ('invoice' as const) : ('preauthorization_request' as const),
        similar: others.map((other) => ({ caseId: other.caseId, caseNumber: other.caseNumber, clientDisplayName: other.clientDisplayName })),
      };
    }),
  );
  return options.similarOnly ? listed.filter((row) => row.similar.length > 0) : listed;
}

// Exactly what a fix would change, in words, before the administrator confirms.
export async function previewCaseFix(db: Database, rawInput: unknown) {
  const input = parseFix(rawInput);
  return db.transaction(async (tx) => {
    const changes = await plan(tx, input, new Date());
    const invoiceIds = [...new Set(changes.filter((change) => change.table === 'invoice' && change.column === 'case_id').map((change) => change.rowId))];
    const requestIds = [...new Set(changes.filter((change) => change.table === 'preauthorization_request' && change.column === 'case_id').map((change) => change.rowId))];
    const preauthorizationIds = changes.filter((change) => change.table === 'preauthorization').map((change) => change.rowId);
    // One query at a time: a transaction's client runs them in turn.
    const invoices = invoiceIds.length
      ? await tx
          .select({
              invoiceId: invoice.invoiceId,
              senderDisplayName: professional.displayName,
              statusName: invoiceStatuses.displayName,
              submittedTotal: invoice.submittedTotal,
              caseNumberAsTyped: invoice.caseNumberAsTyped,
            })
            .from(invoice)
            .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
            .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
            .where(inArray(invoice.invoiceId, invoiceIds))
        : [];
    const requests = requestIds.length
        ? await tx
            .select({ preauthorizationRequestId: preauthorizationRequest.preauthorizationRequestId, requestNumber: preauthorizationRequest.requestNumber })
            .from(preauthorizationRequest)
            .where(inArray(preauthorizationRequest.preauthorizationRequestId, requestIds))
        : [];
    const preauthorizations = preauthorizationIds.length
        ? await tx
            .select({ preauthorizationId: preauthorization.preauthorizationId, providerDisplayName: professional.displayName, caseId: preauthorization.caseId })
            .from(preauthorization)
            .leftJoin(professional, eq(preauthorization.professionalId, professional.professionalId))
            .where(inArray(preauthorization.preauthorizationId, preauthorizationIds))
        : [];
    const conflicts = input.kind === 'same_case' ? await preauthorizationConflicts(tx, input.caseId, input.keptCaseId) : [];
    const conflictNames = conflicts.length
      ? await tx
          .select({ professionalId: professional.professionalId, displayName: professional.displayName })
          .from(professional)
          .where(inArray(professional.professionalId, conflicts.map((conflict) => conflict.professionalId)))
      : [];
    return {
      invoices,
      preauthorizationRequests: requests,
      preauthorizations: preauthorizations.map((row) => ({ ...row, staysOnClosedCase: row.caseId !== input.caseId })),
      preauthorizationChoices: conflicts.map((conflict) => ({
        professionalId: conflict.professionalId,
        providerDisplayName: conflictNames.find((name) => name.professionalId === conflict.professionalId)?.displayName ?? null,
      })),
      assignmentsMoved: changes.filter((change) => change.table === 'case_assignment' && change.column === 'case_id').length,
      assignmentsEnded: changes.filter((change) => change.table === 'case_assignment' && change.column === 'ended_at').length,
      caseChanges: changes.filter((change) => change.table === 'case' && ['external_reference', 'county_id'].includes(change.column)),
      closes: closes(input),
    };
  });
}

export async function listCaseFixes(db: DatabaseOrTransaction, limit = 20) {
  return db
    .select({
      caseCorrectionId: caseCorrection.caseCorrectionId,
      caseId: caseCorrection.caseId,
      caseNumber: caseTable.externalReference,
      kind: caseCorrection.kind,
      keptCaseId: caseCorrection.keptCaseId,
      keptCaseNumber: keptCase.externalReference,
      correctedAt: caseCorrection.correctedAt,
      correctedByDisplayName: userAccount.displayName,
      undoneAt: caseCorrection.undoneAt,
    })
    .from(caseCorrection)
    .innerJoin(caseTable, eq(caseCorrection.caseId, caseTable.caseId))
    .leftJoin(keptCase, eq(caseCorrection.keptCaseId, keptCase.caseId))
    .innerJoin(userAccount, eq(caseCorrection.correctedByUserAccountId, userAccount.userAccountId))
    .orderBy(desc(caseCorrection.correctedAt))
    .limit(limit);
}
