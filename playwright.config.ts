import { defineConfig, devices } from "@playwright/test";

/**
 * The acceptance viewport is a phone. Everything else is a check that nothing
 * breaks on the way up to a desktop.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DEFINIT_E2E_BASE ?? "http://localhost:3000",
    trace: "off",
  },
  webServer: process.env.DEFINIT_E2E_BASE
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "phone-small", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 640 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
