import { test, expect } from "@playwright/test";

// Phase 1 E2E smoke. Lights up against the Vite dev server (`vite:dev`).
// The Tauri-window E2E lights up later in the plan via tauri-driver.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgemark.firstRunDone", "true");
  });
});

test("dev surface loads with the Forgemark shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("http://localhost:1420/");
  await expect(page).toHaveTitle("Forgemark — Untitled");

  // Title bar, editor pane, sidebar all render.
  await expect(page.getByTestId("fm-titlebar")).toBeVisible();
  await expect(page.getByTestId("fm-editor-pane")).toBeVisible();
  await expect(page.getByTestId("fm-sidebar")).toBeVisible();

  // Title bar shows the file name.
  await expect(page.locator(".fm-titlebar-filename")).toHaveText("Untitled");

  // No console errors at boot.
  expect(errors, "no console errors at boot").toEqual([]);
});

test("sidebar can be hidden and shown via the toggle", async ({ page }) => {
  await page.goto("http://localhost:1420/");
  const sidebar = page.getByTestId("fm-sidebar");
  await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Hide comments" }).click();
  await expect(sidebar).not.toBeVisible();
  await page.getByRole("button", { name: "Show comments" }).click();
  await expect(sidebar).toBeVisible();
});

test("view mode toggle switches between rendered and source", async ({ page }) => {
  await page.goto("http://localhost:1420/");

  // Default is Rendered; the Tiptap surface is mounted.
  await expect(page.getByTestId("fm-rendered-view")).toBeAttached();
  await expect(page.getByTestId("fm-source-view")).not.toBeAttached();

  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByTestId("fm-source-view")).toBeAttached();
  await expect(page.getByTestId("fm-rendered-view")).not.toBeAttached();

  await page.getByRole("tab", { name: "Rendered" }).click();
  await expect(page.getByTestId("fm-rendered-view")).toBeAttached();
});
