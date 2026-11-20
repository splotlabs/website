import { defineConfig } from "@playwright/test";

// The tests run against the production build, served by the project Wrangler.
// That exercises the Workers Static Assets routing and the _headers file.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8787",
    // Locally, use the installed Chrome. CI installs the Playwright Chromium.
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "npx wrangler dev --ip 127.0.0.1 --port 8787",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: false,
  },
});
