import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const testDir = defineBddConfig({
  features: ['tests/features/**/*.feature', '!tests/features/.archive/**', '!tests/features/.wip/**'],
  steps: 'tests/steps/**/*.steps.ts',
});

export default defineConfig({
  testDir,
  // Serial everywhere, not just in CI. These scenarios share one ZoneMinder
  // and one app: they create and delete profiles, archive events, and toggle
  // per-profile settings, so running them concurrently makes them fight over
  // the same state. Locally that produced six or seven phantom failures a run
  // that all passed serially, which is #237 reappearing - that issue was
  // closed without changing this line.
  //
  // It matters beyond developer patience: make_release.sh runs this suite
  // before it will tag a release, and a gate that cries wolf gets bypassed.
  // Set E2E_WORKERS to override when you know the subset you are running is
  // independent.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1,
  reporter: [['html']],

  timeout: 30000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on', // Capture trace for all tests (shows timeline with screenshots of every action)
    screenshot: 'on',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Note: BDD tests handle authentication in the Background step
        // No storageState needed - each test authenticates via Given step
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
          ],
        },
      },
    },
  ],

  // Two servers: the CORS proxy (3001) and Vite (5173). They are listed
  // separately, rather than as a single `dev:all`, so Playwright waits for
  // both to be ready before running. Web login fails without the proxy, and
  // waiting only on 5173 let tests start before the proxy was up. The proxy
  // returns 400 on /proxy with no target, which Playwright accepts as ready.
  webServer: [
    {
      command: 'npm run proxy',
      url: 'http://localhost:3001/proxy',
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60 * 1000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 120 * 1000,
    },
  ],
});
