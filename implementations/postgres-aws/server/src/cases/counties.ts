// Counties, and settings recorded in a county's place such as post-conviction
// (model/rules.yaml record_case_county): settings listed first, a county
// added by typing its name, and one suggested from an invoice file.
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction, Transaction } from '../db/client';
import { auditEvent, caseTable, county, invoice } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import type { ParsedInvoice } from '../imports/parsedInvoice';

// In every deployment (../db/ensureReferenceData.ts).
export const DEFAULT_SETTINGS = ['Post-conviction', 'Prison'];

export interface CountyOption {
  countyId: string;
  displayName: string;
  isCounty: boolean;
}

// Ignores case, spacing, punctuation and the word "county", so "County of
// Sample", "Sample County" and "sample" are one county.
export function countyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bcounty\b/g, ' ')
    .replace(/^\s*of\b/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

// countyId null clears it; countyName adds or reuses one; neither leaves it
// on create, and is refused on a change (resolveCountyChange).
export const countyChoice = {
  countyId: z.uuid('Choose a county from the list.').nullable().optional(),
  countyName: z.string().trim().max(100, 'Keep the county under 100 characters.').optional(),
};

export type CountyChoice = { countyId?: string | null; countyName?: string };

export function parseCountyChoice(rawInput: unknown): CountyChoice {
  const parsed = z.object(countyChoice).safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return parsed.data;
}

// The county an invoice shows: its own, else its case's.
export async function shownInvoiceCounty(
  db: DatabaseOrTransaction,
  invoiceId: string,
): Promise<{ countyId: string; displayName: string } | null> {
  const [row] = await db
    .select({ countyId: county.countyId, displayName: county.displayName })
    .from(invoice)
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .innerJoin(county, eq(county.countyId, sql`coalesce(${invoice.countyId}, ${caseTable.countyId})`))
    .where(eq(invoice.invoiceId, invoiceId));
  return row ?? null;
}

// Adds each default setting no county shares a key with, and makes one
// typed in as a county before it a setting.
export async function ensureDefaultSettings(db: DatabaseOrTransaction): Promise<void> {
  const rows = await db.select({ countyId: county.countyId, displayName: county.displayName, isCounty: county.isCounty }).from(county);
  for (const name of DEFAULT_SETTINGS) {
    const same = rows.filter((row) => countyKey(row.displayName) === countyKey(name));
    if (same.length === 0) {
      await db.insert(county).values({ displayName: name, isCounty: false });
    }
    for (const row of same.filter((row) => row.isCounty)) {
      await db.update(county).set({ isCounty: false }).where(eq(county.countyId, row.countyId));
    }
  }
}

export async function listCounties(db: DatabaseOrTransaction): Promise<CountyOption[]> {
  return db
    .select({ countyId: county.countyId, displayName: county.displayName, isCounty: county.isCounty })
    .from(county)
    .where(eq(county.active, true))
    .orderBy(asc(county.isCounty), asc(county.displayName));
}

// Undefined when none was given. A typed name reuses the county with its
// key, or adds one (audited); a retired one is refused, not reactivated.
export async function resolveCounty(tx: Transaction, actorUserAccountId: string, choice: CountyChoice): Promise<string | null | undefined> {
  if (choice.countyName) {
    const displayName = choice.countyName.replace(/\s+/g, ' ');
    const key = countyKey(displayName);
    if (!key) {
      throw new ValidationError({ countyName: 'Enter the county’s name.' });
    }
    // One at a time, so two people adding the same county add it once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('county'))`);
    const existing = (await tx.select().from(county)).find((row) => countyKey(row.displayName) === key);
    if (existing) {
      if (!existing.active) {
        throw new ValidationError({ countyName: `${existing.displayName} is no longer used. Choose another county.` });
      }
      return existing.countyId;
    }
    const [added] = await tx.insert(county).values({ displayName }).returning({ countyId: county.countyId });
    await tx.insert(auditEvent).values({
      entityType: 'county',
      entityId: added!.countyId,
      eventType: 'county_added',
      actorUserAccountId,
      occurredAt: new Date(),
    });
    return added!.countyId;
  }
  if (choice.countyId) {
    const [row] = await tx.select({ active: county.active }).from(county).where(eq(county.countyId, choice.countyId));
    if (!row?.active) {
      throw new ValidationError({ countyId: 'Choose a county from the list.' });
    }
    return choice.countyId;
  }
  return choice.countyId === null ? null : undefined;
}

// A change must say which county, or clear it with countyId null.
export async function resolveCountyChange(tx: Transaction, actorUserAccountId: string, choice: CountyChoice): Promise<string | null> {
  const countyId = await resolveCounty(tx, actorUserAccountId, choice);
  if (countyId === undefined) {
    throw new ValidationError({ countyId: 'Choose a county, or clear it.' });
  }
  return countyId;
}

// --- Read from a file ----------------------------------------------------

export interface ReadCounty {
  // Null: named in the file but not yet on the list.
  countyId: string | null;
  displayName: string;
}

const NOT_A_PLACE = new Set([
  'court', 'superior', 'district', 'circuit', 'municipal', 'justice', 'juvenile', 'family', 'probate', 'criminal',
  'state', 'the', 'of', 'for', 'in', 'and', 're', 'division', 'department', 'dept', 'county',
]);
const WORD = String.raw`[A-Z][\w'.-]*`;
// Up to four words split by single spaces, so a column after it isn't taken.
const LABELLED = /\bcounty[ \t]*:[ \t]*([A-Za-z][\w'.-]*(?: [A-Za-z][\w'.-]*){0,3})/i;
// A county not listed is taken only where a court is named with it, so a
// client's name before "County" isn't read as one.
const COUNTY_OF = new RegExp(String.raw`\b(?:County|COUNTY)[ \t]+(?:of|OF)[ \t]+((?:${WORD}[ \t]+){0,2}${WORD})`, 'g');
const COURT_OF_COUNTY = new RegExp(
  String.raw`\b(?:Court|COURT)[ \t]+(?:of|for|OF|FOR)[ \t]+((?:${WORD}[ \t]+){0,2}${WORD})[ \t]+(?:County|COUNTY)\b`,
  'g',
);
const COUNTY_COURT = new RegExp(
  String.raw`\b((?:${WORD}[ \t]+){0,2}${WORD})[ \t]+(?:County|COUNTY)[ \t]+(?:${WORD}[ \t]+)?(?:Court|COURT)\b`,
  'g',
);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "SUPERIOR COURT OF SAMPLE" or "Sample Superior Court" → "Sample".
function placeName(text: string): string | null {
  const words = text.split(/[ \t]+/);
  const isPlace = (word: string) => !NOT_A_PLACE.has(word.toLowerCase());
  const start = words.findIndex(isPlace);
  if (start < 0) return null;
  const end = words.findIndex((word, index) => index > start && !isPlace(word));
  const place = words.slice(start, end < 0 ? undefined : end).join(' ');
  return place === place.toUpperCase() ? place.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : place;
}

// A listed county named with the word "county", as written or in capitals.
function namesCounty(text: string, option: CountyOption): boolean {
  const core = option.displayName.replace(/\b(county|of)\b/gi, ' ').trim().replace(/\s+/g, ' ');
  if (!core) return false;
  const name = `(?:${escape(core)}|${escape(core.toUpperCase())})`;
  const word = '(?:[Cc]ounty|COUNTY)';
  return new RegExp(String.raw`(?<![\w])(?:${word}[ \t]+(?:(?:of|OF)[ \t]+)?${name}|${name}[ \t]+${word})(?![\w])`).test(text);
}

// Its words may be joined by a space or hyphen.
function namesSetting(text: string, option: CountyOption): boolean {
  const words = option.displayName.split(/[\s-]+/).filter(Boolean).map(escape);
  return words.length > 0 && new RegExp(String.raw`\b${words.join('[\\s-]?')}\b`, 'i').test(text);
}

// A labelled county first, then a setting no item mentions (a visit to a
// prison on one line says nothing of the case), then a county the text
// names, preferring one already listed.
export function readCounty(parsed: Pick<ParsedInvoice, 'invoiceText' | 'lines'>, options: CountyOption[]): ReadCounty | null {
  const text = parsed.invoiceText ?? '';
  const listed = (name: string): ReadCounty | null => {
    const option = options.find((row) => countyKey(row.displayName) === countyKey(name));
    return option ? { countyId: option.countyId, displayName: option.displayName } : null;
  };
  const labelled = LABELLED.exec(text)?.[1]?.trim();
  if (labelled && countyKey(labelled)) {
    return listed(labelled) ?? { countyId: null, displayName: labelled };
  }
  const items = parsed.lines.map((line) => line.description ?? '').join('\n');
  const setting = options.find((option) => !option.isCounty && namesSetting(text, option) && !namesSetting(items, option));
  if (setting) {
    return { countyId: setting.countyId, displayName: setting.displayName };
  }
  const known = options.find((option) => option.isCounty && namesCounty(text, option));
  if (known) {
    return { countyId: known.countyId, displayName: known.displayName };
  }
  const named = [...text.matchAll(COUNTY_OF), ...text.matchAll(COURT_OF_COUNTY), ...text.matchAll(COUNTY_COURT)]
    .sort((a, b) => a.index - b.index)
    .flatMap((match) => {
      const place = placeName(match[1]!);
      return place ? [place] : [];
    });
  const first = named[0];
  return first ? (listed(first) ?? { countyId: null, displayName: `${first} County` }) : null;
}
