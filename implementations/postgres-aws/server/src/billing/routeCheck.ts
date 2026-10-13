// Driving distances for the mileage distance rule (model/rules.yaml
// apply_billing_rules). Looked up only when an invoice is submitted with the
// rule on and cached by address pair, so the routing service's cost stays
// low; each month's calls are counted for a warning and an optional limit.
// With no provider configured nothing is looked up, and reviewers check
// trips with a directions link instead.
import { GeoPlacesClient, GeocodeCommand } from '@aws-sdk/client-geo-places';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { expenseTypes, invoiceLine, routeCheck } from '../db/schema';
import { getBillingRules } from './billingRules';

export interface RouteProvider {
  // One-way driving miles, or undefined when an address can't be placed.
  // `countCall` runs before each billable request.
  distanceMiles(origin: string, destination: string, countCall: () => void): Promise<number | undefined>;
}

const METERS_PER_MILE = 1609.344;
// A whole region or country is too vague to measure a trip from.
const TOO_COARSE = new Set(['Country', 'Region', 'SubRegion']);

function awsLocationProvider(country: string): RouteProvider {
  // No retries: each attempt is a billable request.
  const places = new GeoPlacesClient({ maxAttempts: 1 });
  const routes = new GeoRoutesClient({ maxAttempts: 1 });
  const options = () => ({ abortSignal: AbortSignal.timeout(5000) });
  async function place(text: string, countCall: () => void): Promise<number[] | undefined> {
    countCall();
    const result = await places.send(
      new GeocodeCommand({ QueryText: text, MaxResults: 1, Filter: { IncludeCountries: [country] } }),
      options(),
    );
    const item = result.ResultItems?.[0];
    return item?.Position && !TOO_COARSE.has(item.PlaceType ?? '') ? item.Position : undefined;
  }
  return {
    async distanceMiles(origin, destination, countCall) {
      const from = await place(origin, countCall);
      const to = from && (await place(destination, countCall));
      if (!from || !to) {
        return undefined;
      }
      countCall();
      const result = await routes.send(
        new CalculateRoutesCommand({ Origin: from, Destination: to, TravelMode: 'Car', LegAdditionalFeatures: ['Summary'] }),
        options(),
      );
      const meters = result.Routes?.[0]?.Summary?.Distance;
      return meters === undefined ? undefined : meters / METERS_PER_MILE;
    },
  };
}

let configured: RouteProvider | undefined | null = null;
let testProvider: RouteProvider | undefined;

function routeProvider(): RouteProvider | undefined {
  if (testProvider) {
    return testProvider;
  }
  if (configured === null) {
    configured =
      process.env.ROUTE_CHECK_PROVIDER === 'aws' ? awsLocationProvider(process.env.ROUTE_CHECK_COUNTRY || 'USA') : undefined;
  }
  return configured;
}

export function setRouteProviderForTests(provider: RouteProvider | undefined): void {
  testProvider = provider;
}

function monthlyCalls(name: string, fallback: number | undefined): number | undefined {
  const raw = process.env[name];
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Optional hard stop; unset, lookups never stop.
export const monthlyCallLimit = () => monthlyCalls('ROUTE_CHECK_MONTHLY_CALL_LIMIT', undefined);
// Logged once a month's calls pass it, so heavy use is noticed.
const monthlyCallWarning = () => monthlyCalls('ROUTE_CHECK_MONTHLY_CALL_WARNING', 1000);

// The most one lookup can use: two addresses and a route.
const CALLS_PER_LOOKUP = 3;

// Common spellings of the same address share a key, so "123 Main Street,
// Springfield" reuses the lookup for "123 main st springfield".
const ABBREVIATIONS: Record<string, string> = {
  street: 'st',
  avenue: 'ave',
  road: 'rd',
  drive: 'dr',
  boulevard: 'blvd',
  lane: 'ln',
  court: 'ct',
  place: 'pl',
  highway: 'hwy',
  parkway: 'pkwy',
  circle: 'cir',
  suite: 'ste',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
};
const IGNORED_WORDS = new Set(['usa', 'us', 'united', 'states', 'of', 'america', 'the']);

export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(\d{5})-\d{4}\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => !IGNORED_WORDS.has(word))
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

// Either direction is the same distance, so one lookup serves both.
export function pairKey(origin: string, destination: string): string | undefined {
  const ends = [normalizeAddress(origin), normalizeAddress(destination)].sort();
  return ends[0] && ends[1] && ends[0] !== ends[1] ? ends.join(' | ') : undefined;
}

export interface Trip {
  tripOrigin?: string | null;
  tripDestination?: string | null;
}

// Looks up trips not already measured, until any monthly limit. Never
// throws: a trip that can't be measured is left for the reviewer to check.
export async function measureTrips(db: DatabaseOrTransaction, trips: Trip[]): Promise<void> {
  const provider = routeProvider();
  if (!provider || trips.length === 0) {
    return;
  }
  const rule = (await getBillingRules(db)).find((candidate) => candidate.code === 'mileage_distance');
  if (!rule || rule.enforcement === 'off') {
    return;
  }
  const pairs = new Map<string, { origin: string; destination: string }>();
  for (const { tripOrigin, tripDestination } of trips) {
    const key = tripOrigin && tripDestination ? pairKey(tripOrigin, tripDestination) : undefined;
    if (key) {
      pairs.set(key, { origin: tripOrigin!, destination: tripDestination! });
    }
  }
  if (pairs.size === 0) {
    return;
  }
  const known = await db
    .select({ pairKey: routeCheck.pairKey })
    .from(routeCheck)
    .where(and(inArray(routeCheck.pairKey, [...pairs.keys()]), inArray(routeCheck.outcome, ['found', 'not_found'])));
  for (const row of known) {
    pairs.delete(row.pairKey);
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ calls: sql<string>`coalesce(sum(${routeCheck.apiCalls}), 0)` })
    .from(routeCheck)
    .where(gte(routeCheck.checkedAt, monthStart));
  let used = Number(usage?.calls ?? 0);
  const limit = monthlyCallLimit();
  const warning = monthlyCallWarning();

  for (const [key, { origin, destination }] of pairs) {
    if (limit !== undefined && used + CALLS_PER_LOOKUP > limit) {
      // eslint-disable-next-line no-console
      console.warn(`[route check] monthly limit of ${limit} calls reached; trips are left unchecked`);
      return;
    }
    let calls = 0;
    let outcome: 'found' | 'not_found' | 'error';
    let miles: number | undefined;
    try {
      // eslint-disable-next-line no-await-in-loop
      miles = await provider.distanceMiles(origin, destination, () => {
        calls += 1;
      });
      outcome = miles === undefined ? 'not_found' : 'found';
    } catch (error) {
      outcome = 'error';
      // eslint-disable-next-line no-console
      console.warn('[route check] lookup failed', error instanceof Error ? error.message : error);
    }
    if (warning !== undefined && used <= warning && used + calls > warning) {
      // eslint-disable-next-line no-console
      console.warn(`[route check] more than ${warning} routing calls this month; lookups continue`);
    }
    used += calls;
    // eslint-disable-next-line no-await-in-loop
    await db.insert(routeCheck).values({
      pairKey: key,
      outcome,
      distanceMiles: miles === undefined ? null : miles.toFixed(1),
      apiCalls: calls,
      checkedAt: new Date(),
    });
  }
}

// Copies measured distances onto an invoice's mileage lines, without any
// lookups. Lines whose trip has no measurement are cleared.
export async function applyTripDistances(db: DatabaseOrTransaction, invoiceId: string): Promise<void> {
  const lines = await db
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      tripOrigin: invoiceLine.tripOrigin,
      tripDestination: invoiceLine.tripDestination,
      routeDistance: invoiceLine.routeDistance,
    })
    .from(invoiceLine)
    .innerJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
    .where(and(eq(invoiceLine.invoiceId, invoiceId), eq(expenseTypes.code, 'mileage')));
  const keys = new Map(
    lines.map((line) => [
      line.invoiceLineId,
      line.tripOrigin && line.tripDestination ? pairKey(line.tripOrigin, line.tripDestination) : undefined,
    ]),
  );
  const wanted = [...new Set([...keys.values()].filter((key): key is string => Boolean(key)))];
  const found =
    wanted.length === 0
      ? []
      : await db
          .select({ pairKey: routeCheck.pairKey, distanceMiles: routeCheck.distanceMiles, checkedAt: routeCheck.checkedAt })
          .from(routeCheck)
          .where(and(inArray(routeCheck.pairKey, wanted), eq(routeCheck.outcome, 'found')))
          .orderBy(desc(routeCheck.checkedAt));
  const byKey = new Map<string, (typeof found)[number]>();
  for (const row of found) {
    if (!byKey.has(row.pairKey)) {
      byKey.set(row.pairKey, row);
    }
  }
  for (const line of lines) {
    const key = keys.get(line.invoiceLineId);
    const measured = key ? byKey.get(key) : undefined;
    if ((measured?.distanceMiles ?? null) === line.routeDistance) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(invoiceLine)
      .set({ routeDistance: measured?.distanceMiles ?? null, routeCheckedAt: measured?.checkedAt ?? null })
      .where(eq(invoiceLine.invoiceLineId, line.invoiceLineId));
  }
}
