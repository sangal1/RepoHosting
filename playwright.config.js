import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Local dev workaround: this WSL box lacks a system libasound2. We extracted it
// to a userspace path; prepend it so headless Chromium can launch. On CI (where
// `playwright install-deps` runs) this path won't exist and is skipped.
const localLibs = '/home/sangal/.local/pw-libs';
if (existsSync(localLibs)) {
  process.env.LD_LIBRARY_PATH = `${localLibs}:${process.env.LD_LIBRARY_PATH || ''}`;
}

/**
 * Playwright config for RepoHosting frontend tests.
 * Spins up a static server for the /frontend site on port 4173.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
