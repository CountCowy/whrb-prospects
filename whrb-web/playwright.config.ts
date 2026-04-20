import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import dotenv from 'dotenv';

// Load whrb-web/.env.local for local runs. CI supplies the same vars via
// repo secrets — see `.github/workflows/whrb-web-ci.yml`.
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// Base URL precedence:
//   1. E2E_BASE_URL  — explicit override (CI resolves the Vercel preview URL here).
//   2. PLAYWRIGHT_TEST_BASE_URL — @playwright/test's own convention.
//   3. http://localhost:3000 — local dev default.
const baseURL =
  process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3000';

// When running against localhost we auto-start `pnpm dev`. Against a remote
// baseURL we do not — CI waits for the Vercel preview to be live before
// invoking playwright.
const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(baseURL);

const STORAGE_STATE = path.join(__dirname, 'e2e/.auth/user.json');

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.ts$/,
    },
  ],
  webServer: isLocalhost
    ? {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
