// Everyone who can send invoices, with who is paid, today's approved rates and
// what is waiting. Staff accounts' own profiles are left out, as in
// ../routes/professionals.ts.
import { and, count, eq, inArray, isNull, max, notInArray, or, sql, sum, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DatabaseOrTransaction } from '../db/client';
import { invoice, invoiceStatuses, person, professional, professionalKinds, userAccount } from '../db/schema';
import { NotFoundError } from '../errors';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { listOwnTravelRates, listRates, rateOn } from '../billing/professionalRates';
import { mileageRateOn, mileageRatesForEach } from '../billing/mileageRates';
import { loadPersonReviewer } from '../billing/reviewAssignment';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { afterCursor, cursorColumn, oneBatch, orderByKeys, sortKey, type BatchRequest, type SortKey } from '../lists/batches';

// Not staff accounts' own profiles; a vendor account has no system role, and plain `not in` would drop NULLs.
async function notStaff(db: DatabaseOrTransaction): Promise<SQL> {
  const staffAccountRoleIds = await getStaffAccountRoleIds(db);
  return or(isNull(userAccount.systemRoleId), notInArray(userAccount.systemRoleId, staffAccountRoleIds))!;
}

const BY_NAME: SortKey[] = [sortKey(sql`coalesce(${professional.displayName}, '')`, 'text'), sortKey(sql`${professional.professionalId}`, 'uuid')];

function peopleRows(db: DatabaseOrTransaction) {
  return db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      active: professional.active,
      // Someone added who hasn't signed in has it on their person record.
      email: sql<string | null>`coalesce(${userAccount.email}, ${person.email})`,
      signedIn: sql<boolean>`${professional.userAccountId} is not null`,
      phone: professional.phone,
      paidThrough: professional.paidThrough,
      professionalKindId: professional.professionalKindId,
      role: professionalKinds.displayName,
      cursor: cursorColumn(BY_NAME),
    })
    .from(professional)
    .innerJoin(person, eq(professional.personId, person.personId))
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id));
}

async function withRates<Row extends { professionalId: string }>(db: DatabaseOrTransaction, people: Row[]) {
  const ids = people.map((row) => row.professionalId);
  const today = new Date().toISOString().slice(0, 10);
  const [rates, mileage, travel] = await Promise.all([listRates(db, ids), mileageRatesForEach(db, ids), listOwnTravelRates(db, ids)]);
  return people.map((row) => ({
    ...row,
    hourlyRate: rateOn(rates, row.professionalId, today) ?? null,
    ratePerMile: mileageRateOn(mileage.get(row.professionalId) ?? [], today) ?? null,
    // Their own only; without one, travel time follows the travel time setting.
    travelHourlyRate: rateOn(travel.get(row.professionalId) ?? [], row.professionalId, today) ?? null,
  }));
}

// role: a kind's name, or 'none' for those without one; q: their name or email.
export interface PeopleRequest {
  role?: string;
  q?: string;
}

// Everyone who can send invoices, by name, a batch at a time; with each role's count on the first.
export async function listPeopleBatch(db: DatabaseOrTransaction, request: PeopleRequest, batch: BatchRequest) {
  const words = request.q?.trim().toLowerCase();
  const base = and(
    await notStaff(db),
    isNull(person.mergedIntoPersonId),
    words ? sql`strpos(lower(coalesce(${professional.displayName}, '') || ' ' || coalesce(${userAccount.email}, ${person.email}, '')), ${words}) > 0` : undefined,
  );
  const inRole = request.role ? (request.role === 'none' ? isNull(professionalKinds.displayName) : eq(professionalKinds.displayName, request.role)) : undefined;
  const { rows, next } = await oneBatch(batch, (after, limit) =>
    peopleRows(db).where(and(base, inRole, afterCursor(BY_NAME, after))).orderBy(...orderByKeys(BY_NAME)).limit(limit),
  );
  const items = (await withActivity(db, await withRates(db, rows))).map(({ cursor: _cursor, ...row }) => row);
  if (batch.after) return { items, next };
  // Whatever the role chosen, so every role's tag has its count.
  const roles = await db
    .select({ role: professionalKinds.displayName, count: count() })
    .from(professional)
    .innerJoin(person, eq(professional.personId, person.personId))
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(base)
    .groupBy(professionalKinds.displayName);
  return { items, next, summary: { roles } };
}

async function selectPeople(db: DatabaseOrTransaction, professionalId: string) {
  // A merged-away profile is still found by its own id.
  const rows = await peopleRows(db).where(and(await notStaff(db), eq(professional.professionalId, professionalId)));
  return withRates(db, rows.map(({ cursor: _cursor, ...row }) => row));
}

// What each is waiting on and when they last sent one.
async function withActivity<Row extends { professionalId: string }>(db: DatabaseOrTransaction, people: Row[]) {
  const ids = people.map((row) => row.professionalId);
  const [waiting, latest] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ professionalId: invoice.professionalId, count: count(), total: sum(invoice.submittedTotal) })
            .from(invoice)
            .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
            .where(and(inArray(invoice.professionalId, ids), inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES)))
            .groupBy(invoice.professionalId),
          db
            .select({ professionalId: invoice.professionalId, at: max(invoice.submittedAt) })
            .from(invoice)
            .where(inArray(invoice.professionalId, ids))
            .groupBy(invoice.professionalId),
        ]);
  return people.map((row) => {
    const waitingRow = waiting.find((entry) => entry.professionalId === row.professionalId);
    return {
      ...row,
      waiting: { count: waitingRow?.count ?? 0, total: waitingRow?.total ?? '0.00' },
      lastInvoiceAt: latest.find((entry) => entry.professionalId === row.professionalId)?.at ?? null,
    };
  });
}

// Their invoices come from the queue (../billing/reviewQueue.ts).
export async function getPerson(db: DatabaseOrTransaction, professionalId: string) {
  const [row] = z.uuid().safeParse(professionalId).success ? await selectPeople(db, professionalId) : [];
  if (!row) {
    throw new NotFoundError('No such person.');
  }
  return { ...row, reviewer: await loadPersonReviewer(db, professionalId) };
}
