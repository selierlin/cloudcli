import { defineConfig, devices } from '@playwright/test';

const FIXTURE_PORT = 4175;

export default defineConfig({
  testDir: './tests/theme-tokens',
  outputDir: 'test-results/theme-tokens',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/theme-tokens', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${FIXTURE_PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run test:theme-tokens:serve',
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
