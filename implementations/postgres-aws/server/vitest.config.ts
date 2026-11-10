import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Inline, so Vite doesn't search parent folders for one (blocked in the sandbox).
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false, // tests share one DB and truncate between runs
    // Uploads read documents in-process; isolatedExtraction.test.ts covers
    // the child process.
    env: {
      INVOICE_EXTRACTION_ISOLATION: 'inline',
      // Routes use the app's own connection; keep it off the dev database.
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/case_management_postgres_aws_test',
    },
  },
});
