import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs its own isolated copy of the merchants: ports +1000 (5101..5104), schema merchants_test,
// and short status delays, so it never disturbs a dev server on 4101..4104.
const OFFSET = 1000;

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'tsx src/main.ts',
    url: `http://127.0.0.1:${4101 + OFFSET}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      MERCHANTS_PORT_OFFSET: String(OFFSET),
      MERCHANTS_SCHEMA: 'merchants_test',
      CARTWELL_RESOLVE_DELAY_SECONDS: '2',
      SKYLANE_PAID_DELAY_SECONDS: '3',
      LOG_LEVEL: 'warn',
    },
  },
});
