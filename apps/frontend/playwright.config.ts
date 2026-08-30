import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for AfroPay-Stellar E2E + stress testing.
 *
 * Targets the full local stack (frontend :3000, API :3001) as defined in the
 * repository root `docker-compose.yml`.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'x-e2e-stress-run': process.env.E2E_STRESS_RUN ?? 'false',
    },
  },
  projects: [
    {
      name: 'remittance-flow',
      testMatch: /remittance\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});

export { API_URL };