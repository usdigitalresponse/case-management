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
    env: { INVOICE_EXTRACTION_ISOLATION: 'inline' },
  },
});
