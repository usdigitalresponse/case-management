// Saving a draft's or an entry's lines in place, keeping each line's id.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { ValidationError } from '../../errors';
import { expenseTypes, invoice, invoiceLine, invoiceLineTypes, invoiceLineWorkingDecision, invoiceReviewQuestion, invoiceStatuses, timeEntry, trip } from '../../db/schema';
import { authorizeBilling, type PortalActor } from '../../portal/portalActor';
import { recordTimeEntryChange } from '../../portal/changeTimeEntry';
import { priceLines } from '../priceLines';
import { applyTripDistances } from '../routeCheck';
import { WITHDRAWN_INVOICE_STATUS_CODE } from '../invoiceStatusCodes';
import { DraftContent, LINE_TYPE_CODES, LineType, MILEAGE_EXPENSE_TYPE_CODE } from './lineInput';

type TripValues = Pick<typeof trip.$inferInsert, 'tripDate' | 'tripOrigin' | 'tripDestination' | 'roundTrip'>;

// Each line's trip, by key; a mileage line without one gets its own. Every
// line on a trip takes its date, the first one set among them.
function groupTrips<T extends DraftContent['lines'][number]>(lines: T[]): { lines: Array<T & { tripKey?: string }>; trips: Map<string, TripValues> } {
  const trips = new Map<string, TripValues>();
  const keyed = lines.map((line, index) => ({
    ...line,
    tripKey: line.tripKey ? `trip:${line.tripKey}` : line.lineType === 'mileage' ? `line:${index}` : undefined,
  }));
  for (const line of keyed) {
    if (!line.tripKey) continue;
    const found = trips.get(line.tripKey);
    if (!found) {
      trips.set(line.tripKey, {
        tripDate: line.serviceDate,
        tripOrigin: line.tripOrigin,
        tripDestination: line.tripDestination,
        roundTrip: Boolean(line.roundTrip),
      });
    } else if (!found.tripDate && line.serviceDate) {
      found.tripDate = line.serviceDate;
    }
  }
  return {
    trips,
    lines: keyed.map((line) => (line.tripKey ? { ...line, serviceDate: trips.get(line.tripKey)!.tripDate ?? undefined } : line)),
  };
}

// Whether a saved line already holds these values; numbers compare by value,
// as the database writes "0.40" for "0.4".
function sameValues(saved: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return Object.entries(values).every(([key, value]) => {
    const before = saved[key] ?? null;
    if (before === value) return true;
    const numeric = (v: unknown) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
    return numeric(before) && numeric(value) && Number(before) === Number(value);
  });
}

// Each line is rounded to cents once, so the total always equals the sum of
// its lines (model/rules.yaml validate_invoice_total).
export async function replaceLines(
  tx: Transaction,
  actor: PortalActor,
  invoiceId: string,
  // Null for an invoice held in intake (match_invoice_to_case).
  caseId: string | null,
  // Null: staff will choose the professional when they match it to a case.
  billedProfessionalId: string | null,
  content: DraftContent,
  // Off for an unconfirmed import: unmatched lines stay unmatched.
  fillTimekeepers: boolean,
): Promise<string> {
  const billable = await authorizeBilling(tx, actor, caseId, billedProfessionalId);
  const delegated = billedProfessionalId !== actor.professionalId;
  const grouped = groupTrips(content.lines);
  let lines = grouped.lines.map((line) => ({
    ...line,
    amount: line.amount === undefined ? undefined : Math.round(line.amount * 100) / 100,
    timekeeperProfessionalId:
      line.timekeeperProfessionalId ??
      (delegated && fillTimekeepers && !line.proposedTimekeeperName ? (billedProfessionalId ?? undefined) : undefined),
  }));
  if (lines.some((line) => line.timekeeperProfessionalId && !billable.has(line.timekeeperProfessionalId))) {
    throw new ValidationError({
      lines: 'Each item must bill a professional you may act for who is assigned to this case.',
    });
  }

  const sourceTimeEntryIds = lines.flatMap((line) => (line.sourceTimeEntryId ? [line.sourceTimeEntryId] : []));
  if (sourceTimeEntryIds.length > 0 && caseId === null) {
    throw new ValidationError({ lines: 'Recorded time belongs to a case. Match the invoice to its case first.' });
  }
  if (sourceTimeEntryIds.length > 0 && caseId !== null) {
    if (new Set(sourceTimeEntryIds).size !== sourceTimeEntryIds.length) {
      throw new ValidationError({ lines: 'The same time entry is on this invoice more than once.' });
    }
    const entries = await tx
      .select()
      .from(timeEntry)
      .where(
        and(
          inArray(timeEntry.timeEntryId, sourceTimeEntryIds),
          inArray(timeEntry.professionalId, [...billable]),
          eq(timeEntry.caseId, caseId),
        ),
      )
      .for('update');
    const byId = new Map(entries.map((entry) => [entry.timeEntryId, entry]));
    if (sourceTimeEntryIds.some((id) => !byId.has(id))) {
      throw new ValidationError({
        lines: 'Some time on this invoice is not time you may bill on this case.',
      });
    }
    const [elsewhere] = await tx
      .select({ timeEntryId: invoiceLine.sourceTimeEntryId })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(
        and(
          inArray(invoiceLine.sourceTimeEntryId, sourceTimeEntryIds),
          ne(invoiceLine.invoiceId, invoiceId),
          ne(invoiceStatuses.code, WITHDRAWN_INVOICE_STATUS_CODE),
        ),
      )
      .limit(1);
    if (elsewhere) {
      const entry = byId.get(elsewhere.timeEntryId as string);
      throw new ValidationError({
        lines: `The time from ${entry?.activityOn} (${entry?.description}) is already on another invoice.`,
      });
    }
    // A linked line shows its entry; editing the line on a draft edits the
    // entry (model/rules.yaml validate_payment_request). An unconfirmed
    // import only links, so the file's values never overwrite recorded time.
    const synced: typeof lines = [];
    for (const line of lines) {
      const entry = line.sourceTimeEntryId ? byId.get(line.sourceTimeEntryId) : undefined;
      if (!entry) {
        synced.push(line);
        continue;
      }
      const next = {
        activityOn: (fillTimekeepers && line.serviceDate) || entry.activityOn,
        durationHours: fillTimekeepers && line.quantity ? line.quantity.toFixed(2) : entry.durationHours,
        description: (fillTimekeepers && line.description) || entry.description,
      };
      if (
        next.activityOn !== entry.activityOn ||
        Number(next.durationHours) !== Number(entry.durationHours) ||
        next.description !== entry.description
      ) {
        // eslint-disable-next-line no-await-in-loop
        await recordTimeEntryChange(tx, actor.userAccountId, 'changed', entry);
        // eslint-disable-next-line no-await-in-loop
        await tx.update(timeEntry).set(next).where(eq(timeEntry.timeEntryId, entry.timeEntryId));
      }
      synced.push({
        ...line,
        serviceDate: next.activityOn,
        quantity: Number(next.durationHours),
        description: next.description,
        // Whose time it is follows the entry.
        timekeeperProfessionalId:
          delegated || entry.professionalId !== billedProfessionalId ? entry.professionalId : undefined,
      });
    }
    lines = synced;
  }

  // Sequential: a transaction's queries share one connection.
  const lineTypeIds = {} as Record<LineType, string>;
  for (const [lineType, code] of Object.entries(LINE_TYPE_CODES) as Array<[LineType, string]>) {
    // eslint-disable-next-line no-await-in-loop
    lineTypeIds[lineType] = await getReferenceId(tx, invoiceLineTypes, code);
  }
  const mileageTypeId = lines.some((line) => line.lineType === 'mileage')
    ? await getReferenceId(tx, expenseTypes, MILEAGE_EXPENSE_TYPE_CODE)
    : undefined;

  // Submitted values live on in their attempt's snapshot.
  const saved = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  const savedById = new Map(saved.map((row) => [row.invoiceLineId, row]));
  const oldTrips = await tx.select({ tripId: trip.tripId }).from(trip).where(eq(trip.invoiceId, invoiceId));
  const unclaimed = new Set(saved.map((row) => row.invoiceLineId));
  const keptIds = lines.map((line) => (line.invoiceLineId && unclaimed.delete(line.invoiceLineId) ? line.invoiceLineId : undefined));
  // A new line keeps the id its page gave it, so the next save finds it,
  // unless any line anywhere already has that id.
  const proposed = lines.flatMap((line, index) => (!keptIds[index] && line.invoiceLineId ? [line.invoiceLineId] : []));
  const taken = new Set(
    proposed.length === 0
      ? []
      : (await tx.select({ id: invoiceLine.invoiceLineId }).from(invoiceLine).where(inArray(invoiceLine.invoiceLineId, proposed))).map(
          (row) => row.id,
        ),
  );
  const newIds = lines.map((line, index) => {
    const id = line.invoiceLineId;
    if (keptIds[index] || !id || taken.has(id)) return undefined;
    taken.add(id);
    return id;
  });
  const removedIds = [...unclaimed];
  if (removedIds.length > 0) {
    const [asked] = await tx
      .select({ id: invoiceReviewQuestion.invoiceReviewQuestionId })
      .from(invoiceReviewQuestion)
      .where(inArray(invoiceReviewQuestion.invoiceLineId, removedIds))
      .limit(1);
    if (asked) {
      throw new ValidationError({ lines: 'A line with a question on it is kept on the record, so it can’t be removed.' });
    }
    await tx.delete(invoiceLineWorkingDecision).where(inArray(invoiceLineWorkingDecision.invoiceLineId, removedIds));
    await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceLineId, removedIds));
  }
  const tripIds = new Map<string, string>();
  for (const [key, values] of grouped.trips) {
    // eslint-disable-next-line no-await-in-loop
    const { tripId } = firstRow(await tx.insert(trip).values({ invoiceId, ...values }).returning({ tripId: trip.tripId }));
    tripIds.set(key, tripId);
  }
  const rows = lines.map((line, position) => ({
    invoiceId,
    caseId,
    position,
    lineTypeId: lineTypeIds[line.lineType],
    sourceTimeEntryId: line.sourceTimeEntryId,
    // A time line's amount is set by pricing below.
    amount: (line.amount ?? 0).toFixed(2),
    serviceDate: line.serviceDate,
    description: line.description,
    quantity: line.quantity?.toString(),
    unitRate: line.unitRate?.toFixed(2),
    statedAmount: line.statedAmount?.toFixed(2),
    timekeeperLabel: line.timekeeperLabel,
    // Upper case, as billing codes are kept.
    taskCode: line.taskCode?.toUpperCase(),
    activityCode: line.activityCode,
    expenseCode: line.expenseCode,
    timekeeperProfessionalId: line.timekeeperProfessionalId,
    proposedTimekeeperName: line.proposedTimekeeperName,
    proposedTimekeeperEmail: line.proposedTimekeeperName ? line.proposedTimekeeperEmail : undefined,
    sourceLocation: line.sourceLocation,
    expenseTypeId: line.lineType === 'mileage' ? mileageTypeId : undefined,
    tripId: line.tripKey ? tripIds.get(line.tripKey) : undefined,
    timeCategory: line.lineType === 'time' && !line.tripKey ? line.timeCategory : undefined,
  }));
  const added = rows.flatMap((row, index) => (keptIds[index] ? [] : [{ ...row, ...(newIds[index] && { invoiceLineId: newIds[index] }) }]));
  if (added.length > 0) await tx.insert(invoiceLine).values(added);
  for (const [index, row] of rows.entries()) {
    const keptId = keptIds[index];
    if (!keptId) continue;
    // Every column, so a field cleared in the editor is cleared here.
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null])) as typeof row;
    if (sameValues(savedById.get(keptId)!, values)) continue;
    // And the rates pricing sets, as on a new line.
    // eslint-disable-next-line no-await-in-loop
    await tx.update(invoiceLine).set({ ...values, billedRate: null, configuredRate: null }).where(eq(invoiceLine.invoiceLineId, keptId));
  }
  if (oldTrips.length > 0) {
    await tx.delete(trip).where(inArray(trip.tripId, oldTrips.map((row) => row.tripId)));
  }
  await applyTripDistances(tx, invoiceId);
  // A draft may be saved incomplete; confirmation and submission are strict.
  return priceLines(tx, invoiceId, {
    billedProfessionalId,
    unmatchedMeansBilled: fillTimekeepers,
    strict: false,
  });
}
