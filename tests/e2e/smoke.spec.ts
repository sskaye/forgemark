import { test, expect } from "@playwright/test";

// Phase 0 E2E smoke. Lights up fully once Tauri is runnable (Rust toolchain
// installed). For now it exercises the Vite dev server which serves the
// React surface that the Tauri shell wraps. Either way, the title bar
// reads "Forgemark — Untitled" and there are no console errors.
test("dev surface loads with the Forgemark title", async ({ page, browserName: _browserName }) => {
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") messages.push(msg.text());
  });

  await page.goto("http://localhost:1420/");
  await expect(page).toHaveTitle("Forgemark — Untitled");
  await expect(page.locator("h1")).toHaveText("Forgemark");
  expect(messages, "no console errors at boot").toEqual([]);
});
