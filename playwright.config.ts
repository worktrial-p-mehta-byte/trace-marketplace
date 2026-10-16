import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end test of the demo flow against a production build, on its own
 * database (data/e2e.db), trace folder (data/e2e-blobs) and port, so it
 * never touches your dev data.
 *
 *   pnpm build && pnpm e2e
 */
const PORT = 3100;
export const E2E_ENV = {
  DATABASE_PATH: "data/e2e.db",
  BLOB_DIR: "data/e2e-blobs",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "e2e",
  // The flow is one story (share, then buy, then withdraw): run in order.
  fullyParallel: false,
  workers: 1,
  // No retries: the story changes the database as it goes, so a retry would
  // replay it on top of a half-finished run. A flaky step should fail loudly.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A fresh, seeded e2e database, then the production build on it.
    command: `pnpm demo:reset && pnpm --filter @tm/web exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
