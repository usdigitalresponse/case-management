// EXPLAIN ANALYZE each check's slowest queries from the last
// `PERF_SLOW_QUERIES=1 npm run test:perf`, against the data it left in the
// test database. An argument keeps only checks whose name contains it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Measurement } from './measure';

const filter = process.argv[2] ?? '';
const { measurements } = JSON.parse(readFileSync(join(__dirname, 'results', 'latest.json'), 'utf8')) as { measurements: Measurement[] };
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

(async () => {
  try {
    for (const row of measurements.filter((m) => `${m.group} / ${m.name}`.includes(filter))) {
      for (const query of row.slowQueries ?? []) {
        const { rows } = await pool.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers) ${query.sql}`, query.values);
        // In-lists of ids make plan lines very long.
        const plan = rows.map((line) => line['QUERY PLAN'].slice(0, 200)).join('\n');
        process.stdout.write(`\n=== ${row.group} / ${row.name} (${query.ms} ms when timed)\n${plan}\n`);
      }
    }
  } finally {
    await pool.end();
  }
})();
