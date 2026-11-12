// The case step (model/rules.yaml match_invoice_to_case, add_case_from_request):
// a case found by its number within the county, or one added from them with
// nothing else asked. Shared by requests for payment and pre-authorizations.
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { caseLifecycleEvent, caseLifecycleEventTypes, caseParticipant, caseStatuses, caseTable, county, person, role } from '../db/schema';
import { ValidationError } from '../errors';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import { cleanCaseNumber } from '../billing/caseNumbers';
import { findCasesByNumber, type CaseByNumber } from './casesByNumber';
import { OPEN_CASE_STATUS_CODE } from './closeCase';

// The same synthetic opening event ../intake/createCase.ts uses.
const OPENING_EVENT_TYPE_CODE = 'sample_open';

export interface CaseStepMatches {
  // The same number on a case in the same county: chosen without asking.
  exact: CaseByNumber | null;
  // Close numbers in that county or on a case with none; staff say which.
  similar: CaseByNumber[];
}

export async function caseStepMatches(db: DatabaseOrTransaction, caseNumber: string | null, countyId: string | null): Promise<CaseStepMatches> {
  const found = (await findCasesByNumber(db, cleanCaseNumber(caseNumber))).filter(
    (row) => !countyId || !row.countyId || row.countyId === countyId,
  );
  const exact = (countyId && found.find((row) => row.match === 'exact' && row.countyId === countyId)) || null;
  return { exact, similar: found.filter((row) => row !== exact) };
}

// A chosen case must be listed and, where both have one, in the request's county.
export async function requireChoosableCase(db: DatabaseOrTransaction, caseId: string, countyId: string | null) {
  const [row] = await db.select({ closedAsMistake: caseTable.closedAsMistake, countyId: caseTable.countyId }).from(caseTable).where(eq(caseTable.caseId, caseId));
  if (!row || row.closedAsMistake) {
    throw new ValidationError({ caseId: 'Choose a listed case.' });
  }
  if (countyId && row.countyId && row.countyId !== countyId) {
    throw new ValidationError({ caseId: 'That case is in another county. Choose one in this county, or correct the county.' });
  }
}

export interface NewCaseInput {
  caseNumber: string | null;
  countyId: string | null;
  clientName?: string | null;
  // Staff said a similar case is a different one.
  confirmedNew?: boolean;
}

// Refuses what add_case_from_request refuses; nothing is written.
export async function checkNewCase(db: DatabaseOrTransaction, input: NewCaseInput): Promise<{ caseNumber: string; countyId: string }> {
  const caseNumber = cleanCaseNumber(input.caseNumber);
  if (!caseNumber) {
    throw new ValidationError({ caseNumber: 'Add the case number to add its case.' });
  }
  if (!input.countyId) {
    throw new ValidationError({ countyId: 'Add the county to add its case.' });
  }
  const { exact, similar } = await caseStepMatches(db, caseNumber, input.countyId);
  if (exact) {
    throw new ValidationError({ caseNumber: `Case ${exact.caseNumber ?? caseNumber} is already in ${exact.countyDisplayName ?? 'this county'}. Choose it instead.` });
  }
  if (similar.length > 0 && !input.confirmedNew) {
    throw new ValidationError({ confirmedNew: 'A case with a similar number is listed. Say whether it is that case or a new one.' });
  }
  return { caseNumber, countyId: input.countyId };
}

// Its number, county and, if given, a client; opened now by the actor.
export async function addCaseFromRequest(
  tx: Transaction,
  actorUserAccountId: string,
  input: NewCaseInput,
  addedFrom: { invoiceId: string } | { preauthorizationRequestId: string },
): Promise<string> {
  // One at a time per county, so two staff can't both add the same number.
  if (input.countyId) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`case-step:${input.countyId}`}))`);
  }
  const { caseNumber, countyId } = await checkNewCase(tx, input);
  const [countyRow] = await tx.select({ active: county.active }).from(county).where(eq(county.countyId, countyId));
  if (!countyRow?.active) {
    throw new ValidationError({ countyId: 'Choose a listed county.' });
  }
  const statusId = await getReferenceId(tx, caseStatuses, OPEN_CASE_STATUS_CODE);
  const eventTypeId = await getReferenceId(tx, caseLifecycleEventTypes, OPENING_EVENT_TYPE_CODE);
  const now = new Date();
  const clientName = input.clientName?.trim() || null;
  const clientId = clientName
    ? firstRow(await tx.insert(person).values({ displayName: clientName }).returning({ personId: person.personId })).personId
    : null;
  const added = firstRow(
    await tx
      .insert(caseTable)
      .values({
        clientId,
        countyId,
        externalReference: caseNumber,
        statusId,
        openedOn: calendarDateInReportingTimeZone(now),
        addedFromInvoiceId: 'invoiceId' in addedFrom ? addedFrom.invoiceId : null,
        addedFromPreauthorizationRequestId: 'preauthorizationRequestId' in addedFrom ? addedFrom.preauthorizationRequestId : null,
      })
      .returning({ caseId: caseTable.caseId }),
  );
  await tx.insert(caseLifecycleEvent).values({
    caseId: added.caseId,
    sequenceNumber: 1,
    eventTypeId,
    resultingStatusId: statusId,
    effectiveAt: now,
    recordedAt: now,
    actorUserAccountId,
    reasonDetail: 'invoiceId' in addedFrom ? 'Added from an invoice' : 'Added from a pre-authorization request',
  });
  if (clientId) {
    const [clientRole] = await tx
      .select({ roleId: role.roleId })
      .from(role)
      .where(and(eq(role.roleContext, 'case_participant'), eq(role.displayName, 'Client'), eq(role.active, true)));
    if (clientRole) {
      await tx.insert(caseParticipant).values({ caseId: added.caseId, personId: clientId, participantRoleId: clientRole.roleId, startedAt: now });
    }
  }
  return added.caseId;
}
