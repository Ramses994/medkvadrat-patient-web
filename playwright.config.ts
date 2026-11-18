import { defineConfig, devices } from '@playwright/test';

const useChrome = !process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    headless: true,
    ...(useChrome ? { channel: 'chrome' as const } : {}),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/stub-api.mjs',
      url: 'http://127.0.0.1:8091/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run preview',
      url: 'http://127.0.0.1:4177',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
