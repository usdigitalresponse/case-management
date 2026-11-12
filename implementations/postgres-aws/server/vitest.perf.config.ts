import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { QUERY_COUNT_SCALE } from './perf/measure';

// The performance suite (perf/), kept out of `npm test`; see ../README.md.
// --mode queries sets its scale here rather than in the script, for any shell.
export default defineConfig(({ mode }: { mode: string }) => ({
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['perf/**/*.perf.ts'],
    fileParallelism: false,
    hookTimeout: 600_000,
    testTimeout: 600_000,
    env: {
      INVOICE_EXTRACTION_ISOLATION: 'inline',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/case_management_postgres_aws_test',
      ...(mode === 'queries' ? { PERF_SCALE: String(QUERY_COUNT_SCALE), PERF_ITERATIONS: '1' } : {}),
    },
  },
}));
