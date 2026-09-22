import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false, // tests share one DB and truncate between runs
  },
});
