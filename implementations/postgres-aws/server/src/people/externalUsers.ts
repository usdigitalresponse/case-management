// Administrators turn on emailed-code sign-in for an external user (a
// provider or an office's billing delegate), adding an email or the person
// first where needed (model/rules.yaml manage_external_sign_in).
import { z } from 'zod';
import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { auditEvent, office, person, personAffiliation } from '../db/schema';
import { firstRow } from '../db/rowHelpers';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { isNotStaffRole } from '../auth/staffAccountRole';
import { accountSignInProblem } from '../auth/externalSignIn';
import { getDelegateAffiliationRoleId } from '../professionals/delegateRole';
import { addProfessionalSchema, insertProfessional } from '../professionals/addProfessional';
import { emailInUse } from './emails';
import { afterCursor, cursorColumn, oneBatch, orderByKeys, sortKey, type BatchRequest, type SortKey } from '../lists/batches';

const SIGN_IN_EVENTS = ['external_sign_in_enabled', 'external_sign_in_disabled'];

export interface ExternalUser {
  personId: string;
  displayName: string;
  // What they sign in with: their account's, else their person record's.
  email: string | null;
  // Their kind of provider; null for a delegate without a provider profile.
  kind: string | null;
  // Offices they send invoices for, as a billing delegate.
  delegateFor: DelegateOffice[];
  signInEnabled: boolean;
  hasSignedIn: boolean;
  // When sign-in was last turned on or off here.
  signInChangedAt: string | null;
}

export interface DelegateOffice {
  officeId: string;
  displayName: string;
}

// From each external person (alias p) with their provider profile (pr), account (ua) and kind (k).
// Anyone whose sign-in is on, or who was ever a delegate, stays, so it can always be turned off.
async function fromExternalPeople(db: DatabaseOrTransaction): Promise<SQL> {
  const delegateRoleId = await getDelegateAffiliationRoleId(db);
  return sql`
    from person p
    left join lateral (select * from professional where person_id = p.person_id order by professional_id limit 1) pr on true
    left join lateral (
      select * from user_account
      where user_account_id = pr.user_account_id or person_id = p.person_id
      order by (user_account_id = pr.user_account_id) is not true limit 1
    ) ua on true
    left join professional_kinds k on k.id = pr.professional_kind_id
    left join lateral (
      select json_agg(json_build_object('officeId', x.office_id, 'displayName', x.display_name) order by x.display_name) as offices
      from (
        select distinct o.office_id, o.display_name
        from person_affiliation pa join office o on o.office_id = pa.office_id
        where pa.person_id = p.person_id and pa.affiliation_role_id = ${delegateRoleId}
          and pa.started_at <= now() and (pa.ended_at is null or pa.ended_at > now())
      ) x
    ) d on true
    where p.merged_into_person_id is null
      and ${isNotStaffRole(sql`ua.system_role_id`)}
      and (pr.professional_id is not null or ua.user_account_id is not null or p.external_sign_in_enabled
        or exists (select 1 from person_affiliation ever where ever.person_id = p.person_id and ever.affiliation_role_id = ${delegateRoleId}))`;
}

const BY_NAME: SortKey[] = [sortKey(sql`lower(coalesce(pr.display_name, p.display_name))`, 'text'), sortKey(sql`p.person_id`, 'uuid')];

const COLUMNS = sql`
  p.person_id, coalesce(pr.display_name, p.display_name) as display_name,
  coalesce(ua.email, p.email) as email, k.display_name as kind, coalesce(d.offices, '[]'::json) as delegate_for,
  p.external_sign_in_enabled, ua.user_account_id is not null as has_signed_in,
  (select max(occurred_at) from audit_event e where e.entity_type = 'person' and e.entity_id = p.person_id
    and e.event_type in (${sql.join(SIGN_IN_EVENTS.map((type) => sql`${type}`), sql`, `)})) as sign_in_changed_at`;

type Row = {
  person_id: string;
  display_name: string;
  email: string | null;
  kind: string | null;
  delegate_for: DelegateOffice[];
  external_sign_in_enabled: boolean;
  has_signed_in: boolean;
  sign_in_changed_at: string | Date | null;
  cursor: string[] | null;
};

function toExternalUser(row: Omit<Row, 'cursor'>): ExternalUser {
  return {
    personId: row.person_id,
    displayName: row.display_name,
    email: row.email,
    kind: row.kind,
    delegateFor: row.delegate_for,
    signInEnabled: row.external_sign_in_enabled,
    hasSignedIn: row.has_signed_in,
    signInChangedAt: row.sign_in_changed_at === null ? null : new Date(row.sign_in_changed_at).toISOString(),
  };
}

function matching(q: string | undefined): SQL {
  const words = q?.trim().toLowerCase();
  return words ? sql`and strpos(lower(coalesce(pr.display_name, p.display_name) || ' ' || coalesce(ua.email, p.email, '')), ${words}) > 0` : sql``;
}

// Everyone whose sign-in is on, or was turned off here, by name, a batch at a time.
export async function listExternalUsers(db: DatabaseOrTransaction, q: string | undefined, batch: BatchRequest) {
  const from = await fromExternalPeople(db);
  const { rows, next } = await oneBatch(batch, async (after, limit) => {
    const position = afterCursor(BY_NAME, after);
    const result = await db.execute<Row>(sql`
      select ${COLUMNS}, ${cursorColumn(BY_NAME)} as cursor ${from}
        and (p.external_sign_in_enabled or exists (select 1 from audit_event e where e.entity_type = 'person'
          and e.entity_id = p.person_id and e.event_type in (${sql.join(SIGN_IN_EVENTS.map((type) => sql`${type}`), sql`, `)})))
        ${matching(q)} ${position ? sql`and ${position}` : sql``}
      order by ${sql.join(orderByKeys(BY_NAME), sql`, `)} limit ${limit}`);
    return result.rows;
  });
  return { items: rows.map(toExternalUser), next };
}

// For the picker: providers and delegates, whether or not sign-in is on.
export async function searchExternalUsers(db: DatabaseOrTransaction, q: string | undefined): Promise<ExternalUser[]> {
  const result = await db.execute<Row>(sql`
    select ${COLUMNS} ${await fromExternalPeople(db)} ${matching(q)}
    order by ${sql.join(orderByKeys(BY_NAME), sql`, `)} limit 20`);
  return result.rows.map(toExternalUser);
}

async function getExternalUser(db: DatabaseOrTransaction, personId: string): Promise<ExternalUser> {
  const result = await db.execute<Row>(sql`select ${COLUMNS} ${await fromExternalPeople(db)} and p.person_id = ${personId}`);
  const [row] = result.rows;
  if (!row) throw new NotFoundError('No such external user.');
  return toExternalUser(row);
}

// Offices a new delegate may send invoices for.
export async function listDelegateOffices(db: DatabaseOrTransaction) {
  return db
    .select({ officeId: office.officeId, displayName: office.displayName })
    .from(office)
    .where(and(eq(office.active, true), isNotNull(office.organizationId)))
    .orderBy(asc(office.displayName));
}

const email = z.email('Enter the email they will sign in with.').trim().toLowerCase();
const name = z.string().trim().min(2, 'Enter their name.').max(200);

const existingSchema = z.object({ personId: z.uuid('Choose who should be able to sign in.'), email: email.optional() });
const newProviderSchema = addProfessionalSchema.extend({ email });
const newDelegateSchema = z.object({ displayName: name, email, officeId: z.uuid('Choose the office they send invoices for.') });

type TurnOnInput =
  | z.infer<typeof existingSchema>
  | { newProvider: z.infer<typeof newProviderSchema> }
  | { newDelegate: z.infer<typeof newDelegateSchema> };

function parseTurnOn(rawInput: unknown): TurnOnInput {
  const body = (rawInput ?? {}) as Record<string, unknown>;
  const [key, schema] =
    'newProvider' in body ? (['newProvider', newProviderSchema] as const)
    : 'newDelegate' in body ? (['newDelegate', newDelegateSchema] as const)
    : ([null, existingSchema] as const);
  const parsed = schema.safeParse(key ? body[key] : body);
  if (!parsed.success) throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  return (key ? { [key]: parsed.data } : parsed.data) as TurnOnInput;
}

const EMAIL_IN_USE = 'Someone with this email is already in the system. Find them in the list instead.';

async function setSignIn(tx: Transaction, actorUserAccountId: string, personId: string, enabled: boolean) {
  await tx.update(person).set({ externalSignInEnabled: enabled }).where(eq(person.personId, personId));
  await tx.insert(auditEvent).values({
    entityType: 'person',
    entityId: personId,
    eventType: enabled ? 'external_sign_in_enabled' : 'external_sign_in_disabled',
    actorUserAccountId,
    occurredAt: new Date(),
    priorValues: { externalSignInEnabled: !enabled },
  });
}

// Locks the person, so two administrators' changes apply one after the other.
async function lockExternalUser(tx: Transaction, personId: string): Promise<ExternalUser> {
  if (!z.uuid().safeParse(personId).success) throw new NotFoundError('No such external user.');
  await tx.select({ id: person.personId }).from(person).where(eq(person.personId, personId)).for('update');
  return getExternalUser(tx, personId);
}

export async function turnOnExternalSignIn(db: Database, actorUserAccountId: string, rawInput: unknown): Promise<ExternalUser> {
  const input = parseTurnOn(rawInput);
  const personId = await db.transaction(async (tx) => {
    if ('newProvider' in input) {
      if (await emailInUse(tx, input.newProvider.email, 'any')) throw new ValidationError({ email: EMAIL_IN_USE });
      const added = await insertProfessional(tx, actorUserAccountId, input.newProvider);
      await setSignIn(tx, actorUserAccountId, added.personId, true);
      return added.personId;
    }
    if ('newDelegate' in input) {
      const { displayName, email: newEmail, officeId } = input.newDelegate;
      const [chosen] = await tx
        .select({ organizationId: office.organizationId })
        .from(office)
        .where(and(eq(office.officeId, officeId), eq(office.active, true), isNotNull(office.organizationId)));
      if (!chosen?.organizationId) throw new ValidationError({ officeId: 'Choose the office they send invoices for.' });
      if (await emailInUse(tx, newEmail, 'any')) throw new ValidationError({ email: EMAIL_IN_USE });
      const added = firstRow(await tx.insert(person).values({ displayName, email: newEmail }).returning({ personId: person.personId }));
      await tx.insert(personAffiliation).values({
        personId: added.personId,
        organizationId: chosen.organizationId,
        officeId,
        affiliationRoleId: await getDelegateAffiliationRoleId(tx),
        startedAt: new Date(),
      });
      await tx.insert(auditEvent).values({
        entityType: 'person',
        entityId: added.personId,
        eventType: 'external_delegate_added',
        actorUserAccountId,
        occurredAt: new Date(),
      });
      await setSignIn(tx, actorUserAccountId, added.personId, true);
      return added.personId;
    }

    const existing = await lockExternalUser(tx, input.personId);
    if (existing.signInEnabled) throw new ConflictError('already_on', `${existing.displayName} can already sign in.`);
    if (existing.email) {
      const problem = await accountSignInProblem(tx, existing.email, existing.personId);
      if (problem) throw new ValidationError({ email: problem });
    } else {
      if (!input.email) throw new ValidationError({ email: 'Add the email they will sign in with.' });
      if (await emailInUse(tx, input.email, 'any', existing.personId)) throw new ValidationError({ email: EMAIL_IN_USE });
      await tx.update(person).set({ email: input.email }).where(eq(person.personId, existing.personId));
      await tx.insert(auditEvent).values({
        entityType: 'person',
        entityId: existing.personId,
        eventType: 'person_email_added',
        actorUserAccountId,
        occurredAt: new Date(),
        priorValues: { email: null },
      });
    }
    await setSignIn(tx, actorUserAccountId, existing.personId, true);
    return existing.personId;
  });
  return getExternalUser(db, personId);
}

export async function setExternalSignIn(db: Database, actorUserAccountId: string, personId: string, rawInput: unknown): Promise<ExternalUser> {
  const parsed = z.object({ signInEnabled: z.boolean() }).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError({ signInEnabled: 'Choose on or off.' });
  const enabled = parsed.data.signInEnabled;
  await db.transaction(async (tx) => {
    const existing = await lockExternalUser(tx, personId);
    if (existing.signInEnabled === enabled) return;
    if (enabled && !existing.email) throw new ValidationError({ email: 'Add the email they will sign in with first.' });
    const problem = enabled && existing.email ? await accountSignInProblem(tx, existing.email, personId) : null;
    if (problem) throw new ValidationError({ email: problem });
    await setSignIn(tx, actorUserAccountId, personId, enabled);
  });
  return getExternalUser(db, personId);
}

// Current delegate affiliations of a person with an office.
function delegateAt(personId: string, officeId: string, delegateRoleId: string) {
  return and(
    eq(personAffiliation.personId, personId),
    eq(personAffiliation.officeId, officeId),
    eq(personAffiliation.affiliationRoleId, delegateRoleId),
    sql`${personAffiliation.startedAt} <= now()`,
    sql`(${personAffiliation.endedAt} is null or ${personAffiliation.endedAt} > now())`,
  );
}

// An administrator lets an external user, such as a provider, also send invoices for an office's providers, from now.
export async function addDelegateOffice(db: Database, actorUserAccountId: string, personId: string, rawInput: unknown): Promise<ExternalUser> {
  const parsed = z.object({ officeId: z.uuid('Choose the office they send invoices for.') }).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  const { officeId } = parsed.data;
  await db.transaction(async (tx) => {
    const existing = await lockExternalUser(tx, personId);
    const [chosen] = await tx
      .select({ organizationId: office.organizationId })
      .from(office)
      .where(and(eq(office.officeId, officeId), eq(office.active, true), isNotNull(office.organizationId)));
    if (!chosen?.organizationId) throw new ValidationError({ officeId: 'Choose the office they send invoices for.' });
    if (existing.delegateFor.some((one) => one.officeId === officeId)) {
      throw new ConflictError('already_delegate', `${existing.displayName} already sends invoices for this office.`);
    }
    const [added] = await tx
      .insert(personAffiliation)
      .values({ personId, organizationId: chosen.organizationId, officeId, affiliationRoleId: await getDelegateAffiliationRoleId(tx), startedAt: new Date() })
      .returning({ id: personAffiliation.personAffiliationId });
    await tx.insert(auditEvent).values({
      entityType: 'person',
      entityId: personId,
      eventType: 'external_delegate_office_added',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: { personAffiliationId: added!.id, officeId },
    });
  });
  return getExternalUser(db, personId);
}

// Ends, never deletes, their delegation for the office.
export async function endDelegateOffice(db: Database, actorUserAccountId: string, personId: string, officeId: string): Promise<ExternalUser> {
  if (!z.uuid().safeParse(officeId).success) throw new NotFoundError('They do not send invoices for this office.');
  await db.transaction(async (tx) => {
    await lockExternalUser(tx, personId);
    const ended = await tx
      .update(personAffiliation)
      .set({ endedAt: new Date() })
      .where(delegateAt(personId, officeId, await getDelegateAffiliationRoleId(tx)))
      .returning({ id: personAffiliation.personAffiliationId });
    if (ended.length === 0) throw new NotFoundError('They do not send invoices for this office.');
    await tx.insert(auditEvent).values({
      entityType: 'person',
      entityId: personId,
      eventType: 'external_delegate_office_ended',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: { personAffiliationIds: ended.map((row) => row.id), officeId, endedAt: null },
    });
  });
  return getExternalUser(db, personId);
}
