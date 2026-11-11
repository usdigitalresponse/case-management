import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { timeEntry, person, professional, professionalKinds } from '../../db/schema';
import { billableProfessionalIds, timeReadableProfessionalIds } from '../../portal/portalActor';
import { createTimeEntry } from '../../portal/createTimeEntry';
import { billingOfTimeEntry, deleteTimeEntry, timeEntryLockedReason, updateTimeEntry } from '../../portal/changeTimeEntry';
import { listOwnMileageRates, listOwnTravelRates, listRates, ownFirst } from '../../billing/professionalRates';
import { getBillingRules, listBillingCodes } from '../../billing/billingRules';
import { listMileageRates } from '../../billing/mileageRates';
import { listTimeCategoryRates } from '../../billing/timeCategoryRates';
import { listReceiptChannels } from '../../billing/invoiceReceipt';
import { asyncHandler } from '../asyncHandler';
import { sessionActor } from './sessionActor';

const router = Router();

router.post(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const result = await createTimeEntry(db, await sessionActor(req), req.body);
    res.status(201).json(result);
  }),
);

router.get(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    if (caseId !== undefined && !z.uuid().safeParse(caseId).success) {
      res.json({ timeEntries: [] });
      return;
    }
    const actor = await sessionActor(req);
    // Others' time only case by case.
    const professionalIds = caseId
      ? await timeReadableProfessionalIds(db, actor, caseId)
      : actor.professionalId
        ? [actor.professionalId]
        : [];
    if (professionalIds.length === 0) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const conditions = [inArray(timeEntry.professionalId, professionalIds)];
    if (caseId) {
      conditions.push(eq(timeEntry.caseId, caseId));
    }
    const rows = await db
      .select({ ...getTableColumns(timeEntry), billing: billingOfTimeEntry })
      .from(timeEntry)
      .where(and(...conditions))
      .orderBy(asc(timeEntry.activityOn));
    res.json({
      timeEntries: rows.map((row) => ({ ...row, lockedReason: timeEntryLockedReason(row.billing) })),
    });
  }),
);

router.put(
  '/time-entries/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateTimeEntry(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.delete(
  '/time-entries/:id',
  asyncHandler(async (req, res) => {
    res.json(await deleteTimeEntry(db, await sessionActor(req), req.params.id as string));
  }),
);

// The rules in force, active codes, and mileage, travel and waiting time rates, shown where invoices are entered.
router.get(
  '/billing-rules',
  asyncHandler(async (_req, res) => {
    res.json({
      rules: (await getBillingRules(db)).filter((rule) => rule.enforcement !== 'off'),
      codes: (await listBillingCodes(db)).filter((code) => code.active).map(({ code, displayName }) => ({ code, displayName })),
      mileageRates: await listMileageRates(db),
      timeCategoryRates: await listTimeCategoryRates(db),
    });
  }),
);

// How an invoice staff enter may have been received.
router.get(
  '/receipt-channels',
  asyncHandler(async (_req, res) => {
    res.json({ channels: await listReceiptChannels(db) });
  }),
);

// Whom the user may bill for on a case, or, for staff with no case yet
// (invoice intake), any active professional.
router.get(
  ['/cases/:caseId/billable-professionals', '/billable-professionals'],
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const caseId = (req.params.caseId as string | undefined) ?? null;
    const ids = caseId === null || z.uuid().safeParse(caseId).success ? await billableProfessionalIds(db, actor, caseId) : [];
    const rows =
      ids.length === 0
        ? []
        : await db
            .select({
              professionalId: professional.professionalId,
              displayName: professional.displayName,
              givenName: person.givenName,
              familyName: person.familyName,
              kindDisplayName: professionalKinds.displayName,
            })
            .from(professional)
            .innerJoin(person, eq(professional.personId, person.personId))
            .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
            .where(inArray(professional.professionalId, ids));
    // Everyone who may bill for a professional sees their rates
    // (model/rules.yaml apply_professional_rates).
    const rates = await listRates(db, ids);
    const [generalMileage, ownMileage, ownTravel] = await Promise.all([listMileageRates(db), listOwnMileageRates(db, ids), listOwnTravelRates(db, ids)]);
    res.json({
      professionals: rows.map((row) => {
        const own = ownMileage.get(row.professionalId);
        return {
          ...row,
          isSelf: row.professionalId === actor.professionalId,
          rates: rates
            .filter((rate) => rate.professionalId === row.professionalId)
            .map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
          // Only for someone with their own; the general rates otherwise.
          mileageRates: own ? ownFirst(generalMileage, own, () => '') : [],
          // Their own travel time rates; the travel time setting otherwise.
          travelRates: (ownTravel.get(row.professionalId) ?? []).map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
        };
      }),
    });
  }),
);

export default router;
