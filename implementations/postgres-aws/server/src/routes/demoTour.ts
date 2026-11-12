// The guided demo tour (docs/api.md "Guided tour"): starting a mission makes
// its own synthetic material and signs in as its first role; the tour then
// switches between its demo accounts. Only where both demo sign-ins are on.
import type { Request, Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Database } from '../db/client';
import { userAccount } from '../db/schema';
import { asyncHandler } from './asyncHandler';
import { setSessionUser } from '../auth/session';
import type { AuthenticatedUser } from '../auth/oidcProviders';
import { RateLimiter, type Limit } from '../auth/rateLimit';
import { drawInvoice, timeItem } from '../db/demoUploads';
import { createTourMaterial, FIRST_ROLE, TOUR_MISSIONS, TOUR_RATE, type TourRun } from '../demoTour/tourMaterial';
import { findTourAccounts, TourAccountsMissing, type TourRole } from '../demoTour/tourAccounts';

// Each start writes cases and invoices to the shared demo; a full story takes four.
export const TOUR_STARTS_PER_ADDRESS: Limit = { max: 30, windowMs: 60 * 60 * 1000 };

const tourOf = (req: Request): TourRun | undefined => req.session?.tour as TourRun | undefined;

async function signInAs(req: Request, run: TourRun, role: TourRole): Promise<AuthenticatedUser> {
  const [account] = await db.select().from(userAccount).where(eq(userAccount.userAccountId, run.accounts[role]));
  if (!account) throw new TourAccountsMissing('A tour account is missing; reset the demo data first.');
  const user: AuthenticatedUser = {
    userAccountId: account.userAccountId,
    email: account.email,
    displayName: account.displayName,
    authType: role === 'vendor' ? 'email-code' : 'sso',
  };
  setSessionUser(req, user, { keepTour: true });
  return user;
}

// The tour's sample invoice: over the ceiling it suggests approving, with
// one line missing its date and a stated total the lines don't reach.
export function sampleInvoiceFile(run: TourRun) {
  const sample = run.sample!;
  // Days of the billing period's own month.
  const day = (n: number) => `${sample.periodStart.slice(0, 8)}${String(n).padStart(2, '0')}`;
  const name = run.vendorName;
  const items = [
    timeItem(name, TOUR_RATE, day(3), 'Interviewed the first witness', 6),
    { ...timeItem(name, TOUR_RATE, day(10), 'Interviewed the second and third witnesses', 5), date: undefined },
    timeItem(name, TOUR_RATE, day(17), 'Photographed and measured the scene', 4.5),
    timeItem(name, TOUR_RATE, day(24), 'Wrote the investigation summary', 2),
  ];
  const sum = items.reduce((total, item) => total + item.amount, 0);
  return {
    invoiceNumber: sample.invoiceNumber,
    periodStart: sample.periodStart,
    periodEnd: sample.periodEnd,
    client: run.clientName ?? 'Synthetic Client',
    caseNumber: run.caseNumber,
    items,
    statedTotal: sum + TOUR_RATE / 2,
  };
}

export function addDemoTourRoutes(router: Router, limiter = new RateLimiter()): void {
  router.post(
    '/demo-tour/start',
    asyncHandler(async (req, res) => {
      const parsed = z.object({ mission: z.enum(TOUR_MISSIONS) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Choose one of the tour missions.' });
        return;
      }
      if (!limiter.take(`tour:${req.ip}`, TOUR_STARTS_PER_ADDRESS)) {
        res.status(429).json({ error: 'Too many tours started from here. Try again in an hour.' });
        return;
      }
      try {
        const accounts = await findTourAccounts(db, parsed.data.mission);
        // All or nothing, so a failure leaves no stray cases or invoices. The
        // domain functions take the database; a transaction serves the same calls.
        const { run, suggestions } = await db.transaction((tx) => createTourMaterial(tx as unknown as Database, parsed.data.mission, accounts));
        req.session!.tour = run;
        const role = FIRST_ROLE[run.mission];
        const user = await signInAs(req, run, role);
        res.status(201).json({ run, suggestions, user, role });
      } catch (err) {
        if (err instanceof TourAccountsMissing) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/demo-tour/switch',
    asyncHandler(async (req, res) => {
      const run = tourOf(req);
      const role = z.enum(['staff', 'director', 'vendor']).safeParse((req.body as { role?: unknown } | undefined)?.role);
      if (!run || !role.success) {
        res.status(400).json({ error: 'Start a tour first.' });
        return;
      }
      res.json(await signInAs(req, run, role.data));
    }),
  );

  // Closing the tour: what the visitor does from here on is theirs, not the run's.
  router.post('/demo-tour/end', (req, res) => {
    if (req.session) delete req.session.tour;
    res.status(204).end();
  });

  router.get(
    '/demo-tour/sample-invoice.pdf',
    asyncHandler(async (req, res) => {
      const run = tourOf(req);
      if (!run?.sample) {
        res.status(404).json({ error: 'This tour has no sample invoice.' });
        return;
      }
      const bytes = await drawInvoice(sampleInvoiceFile(run));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Sample_invoice_${run.sample.invoiceNumber}.pdf"`);
      res.send(bytes);
    }),
  );
}
