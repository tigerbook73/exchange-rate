import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A cold `next dev --webpack` compile is slow enough that concurrent
  // workers hitting it simultaneously (first navigation) can starve each
  // other past even a generous per-assertion timeout. One worker locally
  // avoids that contention; CI can still afford --workers if needed.
  workers: process.env.CI ? undefined : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // `pnpm dev` runs on webpack (see AGENTS.md's Turbopack/Serwist note),
    // whose first-navigation compile is noticeably slower than Turbopack's —
    // the default 5s expect timeout flakes on a cold dev server.
    navigationTimeout: 30_000,
  },
  expect: {
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    // If `pnpm test:e2e` ever hangs waiting for this server to become ready,
    // start `pnpm dev` yourself first and rerun — Playwright will reuse it.
    // Observed in some sandboxed environments: a dev server Playwright spawns
    // itself here can hang indefinitely on the first compile, while the
    // exact same command started manually works fine every time. Root cause
    // not fully isolated; not reproduced against a normal local machine.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
