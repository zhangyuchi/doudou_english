import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.js",
  fullyParallel: true,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium-ipad",
      use: { ...devices["iPad (gen 7)"], defaultBrowserType: "chromium" },
    },
    {
      name: "webkit-ipad",
      use: {
        ...devices["iPad (gen 7)"],
        launchOptions: { executablePath: process.env.IPAD_WEBKIT_EXECUTABLE },
      },
    },
  ],
});
