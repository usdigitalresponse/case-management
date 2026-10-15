import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false, // tests share one DB and truncate between runs
    // Uploads read documents in-process; isolatedExtraction.test.ts covers
    // the child process.
    env: { INVOICE_EXTRACTION_ISOLATION: 'inline' },
  },
});
