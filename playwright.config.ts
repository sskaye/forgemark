import { defineConfig } from "@playwright/test";

// Tauri E2E uses tauri-driver / WebDriver. For Phase 0 we run a smoke
// test against the dev URL via Vite; Tauri-window E2E lights up once Rust
// is installed and the smoke harness in tests/e2e/ exercises it.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    actionTimeout: 5_000,
    trace: "retain-on-failure",
  },
  // CI starts Vite itself before running the tests; locally a running
  // `npm run dev` serves the same URL. Either is reused.
  webServer: {
    command: "npm run vite:dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
