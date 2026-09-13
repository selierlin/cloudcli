import { defineConfig, devices } from '@playwright/test';

const FIXTURE_PORT = 4174;

export default defineConfig({
  testDir: './tests/transcript-layout',
  outputDir: 'test-results/transcript-layout',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/transcript-layout', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${FIXTURE_PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run test:transcript:serve',
    url: `http://127.0.0.1:${FIXTURE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
