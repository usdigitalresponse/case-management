// Providers: finding one to assign to a case, the Providers list with each one's kind and rates, and changing
// them. Staff's own profiles are left out by their account roles.
import { Router } from 'express';
import { and, eq, ilike, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { person, professional, professionalKinds, userAccount } from '../db/schema';
import { getSessionUser, requireFullUser } from '../auth/session';
import { addProfessional } from '../professionals/addProfessional';
import { removeProfessional } from '../professionals/removeProfessional';
import { correctNewProfessional } from '../professionals/correctNewProfessional';
import { editProfessional } from '../professionals/editProfessional';
import { requireAdmin } from '../auth/requireAdmin';
import { listRates, setProfessionalKind } from '../billing/professionalRates';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { getPerson, listPeopleBatch } from '../professionals/peopleDirectory';
import { afterCursor, batchRequest, cursorColumn, oneBatch, orderByKeys, sortKey } from '../lists/batches';
import { loadProviderOffices } from '../professionals/providerOffices';
import { asyncHandler } from './asyncHandler';
import { z } from 'zod';
import { NotFoundError } from '../errors';
import { duplicateMembers } from '../duplicateMembers';
import { listPossibleDuplicates, personDuplicateMembers } from '../people/possibleDuplicates';
import { tagTourRecord } from '../demoTour/tourRuns';

const router = Router();
router.use(requireFullUser);

// Providers by name, a batch at a time; q: their name or email.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const staffAccountRoleIds = await getStaffAccountRoleIds(db);
    // External accounts have no role, and `not in` would drop NULLs.
    const filters = [or(isNull(userAccount.systemRoleId), notInArray(userAccount.systemRoleId, staffAccountRoleIds))!, isNull(person.mergedIntoPersonId)];
    if (q) {
      filters.push(or(ilike(userAccount.email, `%${q}%`), ilike(person.email, `%${q}%`), ilike(professional.displayName, `%${q}%`))!);
    }
    const keys = [sortKey(sql`coalesce(${professional.displayName}, '')`, 'text'), sortKey(sql`${professional.professionalId}`, 'uuid')];
    // Providers staff added who haven't signed in have no account; their
    // email is on their person record.
    const { rows, next } = await oneBatch(batchRequest(req.query), (after, limit) =>
      db
        .select({
          professionalId: professional.professionalId,
          personId: professional.personId,
          displayName: professional.displayName,
          active: professional.active,
          // Whether they may sign in (../people/externalUsers.ts); Settings › Providers' Active column.
          externalSignInEnabled: person.externalSignInEnabled,
          email: sql<string | null>`coalesce(${userAccount.email}, ${person.email})`,
          signedIn: sql<boolean>`${professional.userAccountId} is not null`,
          professionalKindId: professional.professionalKindId,
          professionalKindDisplayName: professionalKinds.displayName,
          cursor: cursorColumn(keys),
        })
        .from(professional)
        .innerJoin(person, eq(professional.personId, person.personId))
        .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
        .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
        .where(and(...filters, afterCursor(keys, after)))
        .orderBy(...orderByKeys(keys))
        .limit(limit),
    );
    const ids = rows.map((row) => row.professionalId);
    const [rates, offices] = await Promise.all([listRates(db, ids), loadProviderOffices(db, ids)]);
    res.json({
      items: rows.map((row) => ({
        ...row,
        ...offices.get(row.professionalId)!,
        rates: rates
          .filter((rate) => rate.professionalId === row.professionalId)
          .map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
      })),
      next,
    });
  }),
);

// People by name, a batch at a time (../professionals/peopleDirectory.ts); role: a kind's name or 'none'.
router.get(
  '/people',
  asyncHandler(async (req, res) => {
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.slice(0, 100) : undefined);
    res.json(await listPeopleBatch(db, { role: text(req.query.role), q: text(req.query.q) }, batchRequest(req.query)));
  }),
);

router.get(
  '/people/:id',
  asyncHandler(async (req, res) => {
    res.json(await getPerson(db, req.params.id as string));
  }),
);

// The people this provider may be a duplicate of, for the notice on their page (design K32).
router.get(
  '/people/:id/possible-duplicates',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    if (!z.uuid().safeParse(id).success) throw new NotFoundError('That provider is not in the system.');
    const [row] = await db.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, id));
    if (!row) throw new NotFoundError('That provider is not in the system.');
    const members = await duplicateMembers('people', async () => personDuplicateMembers(await listPossibleDuplicates(db)));
    res.json({ others: members.get(row.personId) ?? [] });
  }),
);

// Any staff member.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const added = await addProfessional(db, getSessionUser(req)!.userAccountId, req.body);
    await tagTourRecord(req, 'professional', added.professionalId);
    res.status(201).json(added);
  }),
);

// Administrators only (../professionals/editProfessional.ts).
router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await editProfessional(db, getSessionUser(req)!.userAccountId, req.params.id as string, req.body));
  }),
);

// By whoever added them (../professionals/correctNewProfessional.ts).
router.put(
  '/:id/details',
  asyncHandler(async (req, res) => {
    res.json(await correctNewProfessional(db, getSessionUser(req)!.userAccountId, req.params.id as string, req.body));
  }),
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await removeProfessional(db, getSessionUser(req)!.userAccountId, req.params.id as string));
  }),
);

// Which kind's rates price this professional's time (model/rules.yaml
// apply_professional_rates). Null clears it.
router.put(
  '/:id/kind',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await setProfessionalKind(db, req.params.id as string, req.body));
  }),
);

export default router;
