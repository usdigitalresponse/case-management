// Read-only reference data for building forms (currently just the intake
// form). One combined response rather than one endpoint per lookup table —
// the client needs all of them together for a single form, and none of
// this data is large enough to justify pagination.
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  caseStatuses,
  caseCategories,
  jurisdictions,
  languages,
  caseIdentifierTypes,
  role,
  county,
  organization,
  office,
} from '../db/schema';
import { requireFullUser } from '../auth/session';
import { asyncHandler } from './asyncHandler';

const router = Router();
// Full staff access only — this backs the intake form, which external
// (magic-link) users never see.
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [
      statuses,
      categories,
      jurisdictionRows,
      languageRows,
      identifierTypes,
      participantRoles,
      counties,
      organizations,
      offices,
    ] = await Promise.all([
      db.select().from(caseStatuses),
      db.select().from(caseCategories),
      db.select().from(jurisdictions),
      db.select().from(languages),
      db.select().from(caseIdentifierTypes),
      db.select().from(role).where(eq(role.roleContext, 'case_participant')),
      db.select().from(county),
      db.select().from(organization),
      db.select().from(office),
    ]);
    res.json({
      caseStatuses: statuses,
      caseCategories: categories,
      jurisdictions: jurisdictionRows,
      languages: languageRows,
      caseIdentifierTypes: identifierTypes,
      participantRoles,
      counties,
      organizations,
      offices,
    });
  }),
);

export default router;
