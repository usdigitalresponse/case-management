// Matching case numbers through the database's close key (../src/billing/caseNumberMatches.ts).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { getReferenceId } from '../src/db/referenceLookups';
import { caseIdentifier, caseTable, invoice, invoiceStatuses } from '../src/db/schema';
import { closeKey } from '../src/billing/caseNumbers';
import { caseNumberMatchesFor, sentCaseNumberCounts } from '../src/billing/caseNumberMatches';
import { findCasesByNumber } from '../src/cases/casesByNumber';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function addCase(externalReference: string | null, primaryIdentifier?: string): Promise<string> {
  const caseId = randomUUID();
  await testDb.insert(caseTable).values({ caseId, externalReference, statusId: fixtures.caseStatusOpenId });
  if (primaryIdentifier) {
    await testDb.insert(caseIdentifier).values({
      caseId,
      identifierTypeId: fixtures.identifierTypeSampleId,
      issuer: 'synthetic',
      value: primaryIdentifier,
      isPrimary: true,
    });
  }
  return caseId;
}

async function addInvoice(status: string, number: { typed?: string; corrected?: string; caseId?: string }): Promise<string> {
  const invoiceId = randomUUID();
  await testDb.insert(invoice).values({
    invoiceId,
    submittedByUserAccountId: fixtures.staffUserAccountId,
    statusId: await getReferenceId(testDb, invoiceStatuses, status),
    submittedTotal: '0',
    caseId: number.caseId ?? null,
    caseNumberAsTyped: number.typed ?? null,
    caseNumberCorrected: number.corrected ?? null,
  });
  return invoiceId;
}

describe('the database close key', () => {
  it('is the same as closeKey for any text', async () => {
    const alphabet = ['a', 'Z', '0', '7', '-', ' ', '.', '#', 'é', 'ß', 'İ', 'ﬁ', '日', '\t', '00'];
    const values = Array.from({ length: 2000 }, (_, i) =>
      Array.from({ length: 1 + (i % 12) }, (_, j) => alphabet[(i * 7 + j * 13 + ((i * j) % 5)) % alphabet.length]).join(''),
    );
    const result = await testDb.execute<{ value: string; key: string }>(
      sql`select value, case_number_close_key(value) as key from unnest(${sql.param(values)}::text[]) as value`,
    );
    const differing = result.rows.filter((row) => row.key !== closeKey(row.value));
    expect(differing).toEqual([]);
  });
});

describe('case number matches', () => {
  it('counts as the queue does, by typed number, correction or case number', async () => {
    const withPrimary = await addCase('IGNORED-REF', '26-CR-00418');
    const withReference = await addCase('26-cr-0418');
    const ids = [
      await addInvoice('submitted', { typed: '26-CR-00418' }),
      await addInvoice('approved', { typed: 'typo', corrected: '26-CR-00418' }),
      await addInvoice('under_review', { caseId: withPrimary }),
      await addInvoice('submitted', { caseId: withReference }),
      await addInvoice('rejected', { typed: '26 CR 418' }),
      await addInvoice('submitted', { typed: '26-CR-00419' }),
    ];
    // Not sent: never counted.
    await addInvoice('draft', { typed: '26-CR-00418' });
    await addInvoice('withdrawn', { typed: '26-CR-00418' });

    const countsOf = await sentCaseNumberCounts(testDb);
    expect(countsOf('26-CR-00418')).toEqual({ same: 2, close: 2 });
    expect(await caseNumberMatchesFor(testDb, ids[0]!)).toEqual({ same: 2, close: 2 });
    expect(await caseNumberMatchesFor(testDb, ids[3]!)).toEqual({ same: 0, close: 4 });
    expect(await caseNumberMatchesFor(testDb, ids[5]!)).toEqual({ same: 0, close: 0 });
    const numbers = ['26-CR-00418', '26-CR-00418', '26-CR-00418', '26-cr-0418', '26 CR 418', '26-CR-00419'];
    for (const [index, invoiceId] of ids.entries()) {
      expect(await caseNumberMatchesFor(testDb, invoiceId)).toEqual(countsOf(numbers[index]!));
    }
  });

  it('has nothing to count for a draft or an invoice with no number', async () => {
    const draft = await addInvoice('draft', { typed: '26-CR-00418' });
    const none = await addInvoice('submitted', {});
    await addInvoice('submitted', { typed: '26-CR-00418' });
    expect(await caseNumberMatchesFor(testDb, draft)).toEqual({ same: 0, close: 0 });
    expect(await caseNumberMatchesFor(testDb, none)).toEqual({ same: 0, close: 0 });
  });

  it('finds cases by their reference or any identifier, exactly or closely', async () => {
    const byReference = await addCase('26-CR-00418');
    const byIdentifier = await addCase('OTHER-1', '26 cr 418');
    await addCase('26-CR-00419');
    const found = await findCasesByNumber(testDb, '26-CR-00418');
    expect(found.map(({ caseId, match }) => ({ caseId, match }))).toEqual([
      { caseId: byReference, match: 'exact' },
      { caseId: byIdentifier, match: 'close' },
    ]);
    expect(await findCasesByNumber(testDb, '---')).toEqual([]);
  });
});
