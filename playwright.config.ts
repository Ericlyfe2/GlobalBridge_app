import { defineConfig } from "@playwright/test";

const PORT = 8081;

/**
 * Playwright E2E for the GlobalBridge mobile app.
 *
 * The app is a native Expo build. On the web platform Metro swaps its
 * native-only modules for test shims (see mobile/metro.config.js), and this
 * suite drives the real screens in Chromium against a stubbed API contract
 * (see e2e/fixtures/api.ts). It is an E2E smoke suite for the UI flows — auth,
 * onboarding, tab navigation, error handling — not a test of the backend.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]],
  outputDir: "e2e/test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // A phone-sized viewport with a desktop chromium engine.
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx expo start mobile --port 8081",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      EXPO_PUBLIC_API_URL: "http://localhost:4100",
      CI: "1",
    },
  },
});