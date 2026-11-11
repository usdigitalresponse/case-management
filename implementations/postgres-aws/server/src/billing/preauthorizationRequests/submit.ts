// A sender asking for a pre-authorization, and the preview of what it would allow.
import { z } from 'zod';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { type Database, type DatabaseOrTransaction, type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { caseAssignment, caseTable, preauthorizationRequest, preauthorizationRequestStatuses, professional, professionalKinds } from '../../db/schema';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { isStaffAccount, billableProfessionalIds, type PortalActor } from '../../portal/portalActor';
import { loadPreauthorizationSummaries, summaryForProfessional, type PreauthorizationSummary } from '../preauthorizations';
import { thresholdBoundProfessionalIds, thresholdFor } from '../preauthorizationThresholds';
import { calendarDateInReportingTimeZone } from '../../reportingTimeZone';
import { fromCents, toCents } from '../money';
import { RATE_BASES, money, parse } from './requestRules';
import { mayFileForProvider, providerDocumentStatus } from './providerRecords';

const requestInputSchema = z
  .object({
    caseId: z.uuid().nullable().optional(),
    proposedCase: z
      .object({
        caseNumber: z.string().trim().min(1, 'Enter the case number.').max(100),
        countyId: z.uuid().nullable().optional(),
        countyName: z.string().trim().max(100).optional(),
      })
      .optional(),
    professionalId: z.uuid().nullable().optional(),
    proposedProvider: z
      .object({
        name: z.string().trim().min(1, 'Enter the provider’s name.').max(200),
        email: z.string().trim().max(200).optional(),
      })
      .optional(),
    professionalKindId: z.uuid().nullable().optional(),
    serviceDescription: z.string().trim().min(1, 'Say what the work is.').max(500),
    rateBasis: z.enum(RATE_BASES, 'Choose hourly, flat or per unit.'),
    requestedRate: money.nullable().optional(),
    estimatedQuantity: z.coerce.number().positive('Enter hours or units above zero.').max(100_000).nullable().optional(),
    requestedAmount: money,
    justification: z.string().trim().min(1, 'Say why the work is needed.').max(4000),
    // Staff recording a request received another way.
    receivedVia: z.string().trim().max(100).optional(),
    receivedOn: z.iso.date().optional(),
    requestedForPersonId: z.uuid().nullable().optional(),
  })
  .refine((input) => input.caseId || input.proposedCase, { path: ['caseId'], message: 'Choose the case, or enter its number.' })
  .refine((input) => input.professionalId || input.proposedProvider, { path: ['professionalId'], message: 'Choose the provider, or enter their name.' })
  .refine((input) => input.rateBasis === 'flat' || input.requestedRate, { path: ['requestedRate'], message: 'Enter the rate.' });

// YY-NNN by the year received, one sequence across requests.
async function nextRequestNumber(tx: Transaction, receivedAt: Date): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('preauthorization_request_number'))`);
  const prefix = `${calendarDateInReportingTimeZone(receivedAt).slice(2, 4)}-`;
  const rows = await tx
    .select({ number: preauthorizationRequest.requestNumber })
    .from(preauthorizationRequest)
    .where(like(preauthorizationRequest.requestNumber, `${prefix}%`));
  const highest = rows.reduce((max, row) => Math.max(max, Number(row.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

async function requireRequesterOnCase(db: DatabaseOrTransaction, actor: PortalActor, caseId: string): Promise<void> {
  if ((await billableProfessionalIds(db, actor, caseId)).length === 0) {
    throw new ForbiddenError('forbidden', 'You can ask only on cases you work on.');
  }
}

// Providers a submitter may name: anyone on their cases, and whoever they bill for.
export async function listRequestableProviders(db: DatabaseOrTransaction, actor: PortalActor) {
  const own = await billableProfessionalIds(db, actor, null);
  if (own.length === 0) return [];
  const cases = await db
    .selectDistinct({ caseId: caseAssignment.caseId })
    .from(caseAssignment)
    .where(and(inArray(caseAssignment.professionalId, own), isNull(caseAssignment.endedAt)));
  const caseIds = cases.map((row) => row.caseId);
  const onCases =
    caseIds.length === 0
      ? []
      : await db
          .selectDistinct({ professionalId: caseAssignment.professionalId })
          .from(caseAssignment)
          .where(and(inArray(caseAssignment.caseId, caseIds), isNull(caseAssignment.endedAt)));
  const ids = [...new Set([...own, ...onCases.map((row) => row.professionalId)])];
  const rows = await db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      professionalKindId: professional.professionalKindId,
      kindName: professionalKinds.displayName,
    })
    .from(professional)
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(and(inArray(professional.professionalId, ids), eq(professional.active, true)))
    .orderBy(asc(professional.displayName));
  return rows;
}

export async function createPreauthorizationRequest(db: Database, actor: PortalActor, rawInput: unknown) {
  const input = parse(requestInputSchema, rawInput);
  const staff = await isStaffAccount(db, actor.userAccountId);
  const caseId = input.caseId ?? null;
  const professionalId = input.professionalId ?? null;
  if (!staff) {
    if (caseId) await requireRequesterOnCase(db, actor, caseId);
    if (professionalId && !(await listRequestableProviders(db, actor)).some((row) => row.professionalId === professionalId)) {
      throw new ValidationError({ professionalId: 'Choose a provider from the list, or enter their name.' });
    }
  }
  if (caseId) {
    const [row] = await db.select({ id: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, caseId));
    if (!row) throw new NotFoundError('Case not found.');
  }
  const receivedAt = staff && input.receivedOn ? new Date(`${input.receivedOn}T12:00:00Z`) : new Date();
  return db.transaction(async (tx) => {
    const preauthorizationId = caseId ? await currentPreauthorizationId(tx, caseId, professionalId) : null;
    const created = firstRow(
      await tx
        .insert(preauthorizationRequest)
        .values({
          requestNumber: await nextRequestNumber(tx, receivedAt),
          caseId,
          professionalId,
          proposedDetails:
            input.proposedCase || input.proposedProvider
              ? { case: caseId ? undefined : input.proposedCase, provider: professionalId ? undefined : input.proposedProvider }
              : null,
          preauthorizationId,
          professionalKindId: input.professionalKindId ?? null,
          serviceDescription: input.serviceDescription,
          rateBasis: input.rateBasis,
          requestedRate: input.rateBasis === 'flat' ? null : (input.requestedRate?.toFixed(2) ?? null),
          estimatedQuantity: input.rateBasis === 'flat' ? null : (input.estimatedQuantity?.toString() ?? null),
          requestedAmount: input.requestedAmount.toFixed(2),
          justification: input.justification,
          statusId: await getReferenceId(tx, preauthorizationRequestStatuses, 'submitted'),
          requestedByUserAccountId: actor.userAccountId,
          requestedForPersonId: staff ? (input.requestedForPersonId ?? null) : null,
          receivedVia: staff ? input.receivedVia || null : null,
          receivedAt,
        })
        .returning({ id: preauthorizationRequest.preauthorizationRequestId, requestNumber: preauthorizationRequest.requestNumber }),
    );
    return { preauthorizationRequestId: created.id, requestNumber: created.requestNumber };
  });
}

export async function currentPreauthorizationId(db: DatabaseOrTransaction, caseId: string, professionalId: string | null): Promise<string | null> {
  if (!professionalId) return null;
  const summary = (await loadPreauthorizationSummaries(db, caseId)).find(
    (row) => row.professionalId === professionalId && row.source === 'preauthorized',
  );
  return summary?.preauthorizationId ?? null;
}

// Shown before sending.
export async function previewRequest(db: DatabaseOrTransaction, actor: PortalActor, rawInput: unknown) {
  const input = parse(
    z.object({ caseId: z.uuid().nullable().optional(), professionalId: z.uuid().nullable().optional(), countyId: z.uuid().nullable().optional(), requestedAmount: z.coerce.number().nonnegative().optional() }),
    rawInput,
  );
  const staff = await isStaffAccount(db, actor.userAccountId);
  if (!staff) {
    if (input.caseId) await requireRequesterOnCase(db, actor, input.caseId);
    if (input.professionalId && !(await mayFileForProvider(db, actor, input.professionalId))) {
      throw new NotFoundError('Provider not found.');
    }
  }
  let limit: PreauthorizationSummary | null = null;
  let countyId = input.countyId ?? null;
  if (input.caseId) {
    const [row] = await db.select({ countyId: caseTable.countyId }).from(caseTable).where(eq(caseTable.caseId, input.caseId));
    countyId = row?.countyId ?? null;
    if (input.professionalId) {
      limit = summaryForProfessional(await loadPreauthorizationSummaries(db, input.caseId, [input.professionalId]), input.professionalId);
    }
  }
  const threshold = await thresholdFor(db, countyId);
  const bound = input.professionalId ? (await thresholdBoundProfessionalIds(db, [input.professionalId])).has(input.professionalId) : true;
  const documents = input.professionalId ? await providerDocumentStatus(db, input.professionalId) : null;
  const billed = limit ? toCents(limit.approvedSoFar) + toCents(limit.waiting) : 0;
  // A total below what's billed is a mistake, not "not needed".
  const coversBilled = input.requestedAmount !== undefined && toCents(input.requestedAmount) >= billed;
  return {
    threshold: bound ? threshold : null,
    limit,
    billed: fromCents(billed),
    withinThreshold:
      bound &&
      threshold !== null &&
      coversBilled &&
      (!limit || limit.source === 'threshold') &&
      toCents(input.requestedAmount!) <= toCents(threshold),
    documents,
  };
}
