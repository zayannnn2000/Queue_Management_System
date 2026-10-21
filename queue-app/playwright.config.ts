import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// The queue is one shared state, so tests run one at a time and each starts with "resetDay".
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    channel: process.env.PW_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: `${BASE_URL}/api/state`, reuseExistingServer: true, timeout: 120_000 },
});
