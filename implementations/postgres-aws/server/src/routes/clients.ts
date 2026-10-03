// Directory of people who are a case's client — the sidebar's "Clients"
// lookup. Unlike ../routes/people.ts (any existing person, used to pick
// one for a new case participant), this is scoped to people who already
// hold the "Client" case_participant-context role on at least one case.
// Server-selected synthetic role name, the same simplification as
// ../intake/createCase.ts's OPENING_EVENT_TYPE_CODE — case_participant
// roles are organization-configurable reference data in the canonical
// model (only seeded by ../db/fixtures.ts, test/dev), not a fixed app
// constant; see MAPPING.md.
import { Router } from 'express';
import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db/client';
import { person, caseParticipant, role } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { asyncHandler } from './asyncHandler';

const CLIENT_PARTICIPANT_ROLE_DISPLAY_NAME = 'Client';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filters = [
      eq(role.displayName, CLIENT_PARTICIPANT_ROLE_DISPLAY_NAME),
      eq(role.roleContext, 'case_participant'),
    ];
    if (q) {
      const pattern = `%${q}%`;
      filters.push(or(ilike(person.displayName, pattern), ilike(person.email, pattern))!);
    }

    const rows = await db
      .selectDistinct({ personId: person.personId, displayName: person.displayName, email: person.email })
      .from(caseParticipant)
      .innerJoin(person, eq(caseParticipant.personId, person.personId))
      .innerJoin(role, eq(caseParticipant.participantRoleId, role.roleId))
      .where(and(...filters))
      .limit(50);
    res.json({ clients: rows });
  }),
);

export default router;
