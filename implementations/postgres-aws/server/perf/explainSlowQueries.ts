// EXPLAIN ANALYZE each check's slowest queries from the last
// `PERF_SLOW_QUERIES=1 npm run test:perf`, against the data it left in the
// test database. An argument keeps only checks whose name contains it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testPool as pool } from '../__tests__/testDb';
import type { Measurement } from './measure';

const filter = process.argv.slice(2).join(' ');
const { measurements } = JSON.parse(readFileSync(join(__dirname, 'results', 'latest.json'), 'utf8')) as { measurements: Measurement[] };
// EXPLAIN takes only these, and ANALYZE runs them, so each is rolled back.
const explainable = /^[\s(]*(select|insert|update|delete|with)\b/i;

(async () => {
  try {
    for (const row of measurements.filter((m) => `${m.group} / ${m.name}`.includes(filter))) {
      for (const query of row.slowQueries ?? []) {
        if (!explainable.test(query.sql)) continue;
        const client = await pool.connect();
        let rows: { 'QUERY PLAN': string }[];
        try {
          await client.query('begin');
          ({ rows } = await client.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers) ${query.sql}`, query.values));
        } finally {
          await client.query('rollback');
          client.release();
        }
        // In-lists of ids make plan lines very long.
        const plan = rows.map((line) => line['QUERY PLAN'].slice(0, 200)).join('\n');
        process.stdout.write(`\n=== ${row.group} / ${row.name} (${query.ms} ms when timed)\n${plan}\n`);
      }
    }
  } finally {
    await pool.end();
  }
})();
