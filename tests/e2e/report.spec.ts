// Reviewing a scripted HTML report, in a real browser.
//
// jsdom cannot run a report's script, lay it out, or notice what its
// redraws do to a highlight. Chromium can. The app runs against the Vite
// dev server with Tauri's bridge replaced by tests/e2e/tauri-shim.ts, so
// the file the app "saves" can be read back and checked byte by byte.

import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import { installTauriShim, type E2EState } from "./tauri-shim";
import { writeInlineDashboard } from "./fixtures";
import { lintText } from "../../cli/lint";

const DASHBOARD = writeInlineDashboard();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriShim);
});

async function openReport(page: Page): Promise<FrameLocator> {
  await page.goto("http://localhost:1420/");
  await expect(page.getByTestId("fm-editor-pane")).toBeVisible();
  await page.evaluate((path) => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path } }));
  }, DASHBOARD);
  const frame = page.frameLocator("[data-testid='fm-html-view']");
  // The report's own script has drawn the tiles.
  await expect(frame.locator("#tiles .tile").first()).toBeVisible();
  // A marker the report keeps only while it is not reloaded.
  await frame.locator("body").evaluate(() => {
    (window as unknown as { __alive: number }).__alive = 1;
  });
  return frame;
}

// The file as the app last saved it.
async function savedFile(page: Page): Promise<string> {
  await expect
    .poll(
      async () =>
        page.evaluate((path) => {
          const s = (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e;
          return s.files[path] ?? null;
        }, DASHBOARD),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return page.evaluate(
    (path) => (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.files[path],
    DASHBOARD,
  );
}

async function notReloaded(frame: FrameLocator) {
  expect(
    await frame
      .locator("body")
      .evaluate(() => (window as unknown as { __alive?: number }).__alive ?? 0),
  ).toBe(1);
}

async function selectInFrame(frame: FrameLocator, phrase: string) {
  await frame.locator("body").evaluate((body, phrase) => {
    const doc = body.ownerDocument;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(phrase);
      if (at < 0) continue;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      // On screen first, as a reader's selection always is; the toolbar
      // floats at the selection.
      node.parentElement?.scrollIntoView({ block: "center" });
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`not found: ${phrase}`);
  }, phrase);
}

async function submitComment(page: Page, text: string) {
  const box = page.getByTestId("fm-composer-textarea");
  await expect(box).toBeVisible();
  await box.fill(text);
  await box.press("Meta+Enter");
  await expect(page.getByTestId("fm-composer")).not.toBeVisible();
}

async function commentOnSelection(page: Page, frame: FrameLocator, phrase: string, text: string) {
  await selectInFrame(frame, phrase);
  const button = page.getByTestId("fm-selection-comment");
  try {
    await button.click();
  } catch (err) {
    const box = await page.getByTestId("fm-selection-toolbar").boundingBox();
    throw new Error(
      `toolbar click failed; toolbar at ${JSON.stringify(box)} in viewport ${JSON.stringify(page.viewportSize())}: ${String(err).slice(0, 200)}`,
    );
  }
  await submitComment(page, text);
}

async function commentOnBlock(page: Page, frame: FrameLocator, label: RegExp, text: string) {
  await frame.locator("button[data-forgemark='block']", { hasText: "Comment" }).first().waitFor();
  const button = frame.getByRole("button", { name: label });
  await button.click();
  await submitComment(page, text);
}

test("the report runs its own script and answers its own controls", async ({ page }) => {
  const frame = await openReport(page);
  await expect(frame.locator("#tiles .tile")).toHaveCount(3);
  await expect(frame.locator("#chart svg")).toBeVisible();
  await expect(frame.locator("#stamp")).not.toBeEmpty();
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await expect(frame.locator("#tiles .tile").first()).toContainText("Average sleep");
  await frame.locator("#range").selectOption("week");
  await expect(frame.locator("#chart-note")).toContainText("7 points");
});

test("a comment on static text is spliced into the file without a reload", async ({ page }) => {
  const frame = await openReport(page);
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await commentOnSelection(page, frame, "Variable projection", "Gloss this.");
  await expect(frame.locator("[data-anchor-id='1']")).toHaveText("Variable projection");
  await expect(frame.getByRole("tab", { name: "Sleep" })).toHaveAttribute("aria-selected", "true");
  await notReloaded(frame);
  const file = await savedFile(page);
  expect(file).toContain("<b><!-- fmc:1 -->Variable projection<!-- /fmc:1 --></b>");
  expect(file).toContain('anchor_text: "Variable projection"');
  expect(lintText(file, "html").problems.filter((p) => p.severity === "error")).toEqual([]);
});

test("a passage a script drew is anchored to its element and found again after a redraw", async ({
  page,
}) => {
  const frame = await openReport(page);
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await commentOnSelection(page, frame, "1h 05m", "Is this the 14-day window?");
  await expect(frame.locator("#tiles [data-anchor-id='1']")).toHaveText("1h 05m");
  // Comment only: the text is the script's, not the source's.
  const file = await savedFile(page);
  expect(file).toContain("anchor_kind: passage");
  expect(file).toContain('anchor_selector: "#tiles"');
  expect(file).toMatch(
    /<!-- fmc:1 --><section class="tiles" id="tiles"><\/section><!-- \/fmc:1 -->/,
  );
  await frame.getByRole("tab", { name: "Glucose" }).click();
  await expect(frame.locator("#tiles [data-anchor-id='1']")).toHaveCount(0);
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await expect(frame.locator("#tiles [data-anchor-id='1']")).toHaveText("1h 05m");
  await notReloaded(frame);
});

test("each tab's chart takes its own comment on the one figure", async ({ page }) => {
  const frame = await openReport(page);
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await commentOnBlock(page, frame, /Figure 2\. Sleep/, "Sleep chart.");
  await expect(frame.locator("#chart")).toHaveAttribute("data-anchor-id", "1");

  await frame.getByRole("tab", { name: "Glucose" }).click();
  await expect(frame.locator("#chart")).not.toHaveAttribute("data-anchor-id", /.*/);
  await commentOnBlock(page, frame, /Figure 2\. Blood glucose/, "Glucose chart.");
  await expect(frame.locator("#chart")).toHaveAttribute("data-anchor-id", "2");

  await frame.getByRole("tab", { name: "Sleep" }).click();
  await expect(frame.locator("#chart")).toHaveAttribute("data-anchor-id", "1");
  await notReloaded(frame);

  const file = await savedFile(page);
  expect(file).toMatch(
    /<!-- fmc:1 --><!-- fmc:2 --><figure id="chart"><\/figure><!-- \/fmc:2 --><!-- \/fmc:1 -->/,
  );
  expect(file.match(/anchor_kind: passage/g)).toHaveLength(2);
  expect(lintText(file, "html").problems.filter((p) => p.severity === "error")).toEqual([]);

  // Deleting one leaves the other, still without a reload. The card's
  // actions show once it is focused.
  await page.getByTestId("fm-card-1").click();
  await page.getByTestId("fm-card-delete-1").click();
  await expect(frame.locator("#chart")).not.toHaveAttribute("data-anchor-id", /.*/);
  await frame.getByRole("tab", { name: "Glucose" }).click();
  await expect(frame.locator("#chart")).toHaveAttribute("data-anchor-id", "2");
  await notReloaded(frame);
  await expect.poll(async () => (await savedFile(page)).includes("fmc:1")).toBe(false);
});

test("a static figure is an element anchor, and a right-click opens the menu", async ({ page }) => {
  const frame = await openReport(page);
  await commentOnBlock(page, frame, /Figure 1\./, "Bars.");
  await expect(frame.locator("#fig-static")).toHaveAttribute("data-anchor-id", "1");
  const file = await savedFile(page);
  expect(file).toContain("anchor_kind: element");
  expect(file).toContain('anchor_selector: "#fig-static"');

  await selectInFrame(frame, "eliminates the linear block");
  await frame.locator("#notes p").first().click({ button: "right" });
  await expect(page.getByTestId("fm-context-menu")).toBeVisible();
});

test("links in the report open outside or scroll the report", async ({ page }) => {
  const frame = await openReport(page);
  await frame.locator("a[href='https://example.com']").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.opened,
      ),
    )
    .toEqual([{ kind: "url", target: "https://example.com/" }]);
  const before = await frame.locator("body").evaluate(() => window.scrollY);
  await frame.locator("a[href='#notes']").click();
  await expect
    .poll(() => frame.locator("body").evaluate(() => window.scrollY))
    .toBeGreaterThan(before);
  await notReloaded(frame);
});

test("a shortcut pressed inside the report reaches the app", async ({ page }) => {
  const frame = await openReport(page);
  await selectInFrame(frame, "Variable projection");
  await frame.locator("#notes p").first().focus();
  await page.keyboard.press("Meta+Alt+m");
  await expect(page.getByTestId("fm-composer")).toBeVisible();
});

test("the report keeps its state behind the source view and across a theme change", async ({
  page,
}) => {
  const frame = await openReport(page);
  await frame.getByRole("tab", { name: "Sleep" }).click();
  await frame.locator("#range").selectOption("week");
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByTestId("fm-source-view")).toBeVisible();
  await page.getByRole("tab", { name: "Rendered" }).click();
  await expect(frame.getByRole("tab", { name: "Sleep" })).toHaveAttribute("aria-selected", "true");
  await expect(frame.locator("#chart-note")).toContainText("7 points");
  await notReloaded(frame);
});

test("a comment card scrolls the report to its highlight", async ({ page }) => {
  const frame = await openReport(page);
  await commentOnSelection(page, frame, "Variable projection", "Down here.");
  // A second comment, near the top, takes the focus; clicking the first
  // card then moves it back and scrolls to its highlight.
  await commentOnSelection(page, frame, "built by its own script", "Up here.");
  await frame.locator("body").evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBe(0);
  await page.getByTestId("fm-card-1").click();
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
