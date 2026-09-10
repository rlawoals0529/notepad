import { defineConfig, devices } from "@playwright/test";

/**
 * Pointed at a production preview rather than the dev server, so what is tested is what
 * gets deployed. The alignment between the document and its margin is a property of the
 * built stylesheet, and a dev server that transforms CSS differently would test a page
 * nobody visits.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4183", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The host is bound explicitly because Vite defaults to "localhost", which resolves to
    // ::1 on some machines, and then the 127.0.0.1 health check waits out its whole timeout
    // against a server that is up and listening somewhere else.
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4183 --strictPort",
    url: "http://127.0.0.1:4183",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
