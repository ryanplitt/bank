import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  workers: 1, // the E2E boots a shared server on a fixed port
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
});
