import { defineConfig } from '@playwright/test';

const port = 3210;

// The end-to-end tests run against the production build: one server that
// serves the API, the WebSocket and the built frontend, with a throwaway database.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm start',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(port), DATABASE_PATH: ':memory:', AUTH_RATE_LIMIT: '1000' },
  },
});
