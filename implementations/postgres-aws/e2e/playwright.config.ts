import { defineConfig, devices } from '@playwright/test';

// Runs against a seeded app with the demo sign-ins on; it adds synthetic
// invoices, so point it only at a disposable database (see README.md).
export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  // WebKit is Safari's engine, where some controls have behaved differently.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
