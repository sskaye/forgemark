// A Markdown file's front matter, in a real browser: shown above the
// document as its YAML, and open to comments that leave the YAML as it
// was. Requested by ForgeGraph, whose agent skill's SKILL.md keeps its
// description there.

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { installTauriShim, type E2EState } from "./tauri-shim";
import { ROOT } from "./fixtures";
import { parseForgemarkFile } from "../../src/format";
import { lintText } from "../../cli/lint";

const TMP = resolve(ROOT, "tests", "e2e", ".tmp", "frontmatter");
mkdirSync(TMP, { recursive: true });
const SOURCE =
  '---\nname: example\ndescription: "What this file is for."\n---\n\n# Heading\n\nBody text.\n';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriShim);
});

async function open(page: Page, path: string) {
  await page.goto("http://localhost:1420/");
  await expect(page.getByTestId("fm-editor-pane").first()).toBeVisible();
  await page.evaluate((p) => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path: p } }));
  }, path);
}

async function savedFile(page: Page, path: string): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (p) =>
            (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.files[p] ?? null,
          path,
        ),
      { timeout: 15_000 },
    )
    .toContain("forgemark-comments");
  return page.evaluate(
    (p) => (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.files[p],
    path,
  );
}

test("the front matter is shown above the document", async ({ page }) => {
  const path = resolve(TMP, "shown.md");
  writeFileSync(path, SOURCE);
  await open(page, path);
  const block = page.locator(".fm-editor-pane[data-active='true'] [data-testid='fm-frontmatter']");
  await expect(block).toContainText("name: example");
  await expect(block).toContainText('description: "What this file is for."');
  // Above the document's first heading.
  const blockBox = await block.boundingBox();
  const heading = await page
    .locator(".fm-editor-pane[data-active='true'] .fm-rendered-view h1")
    .boundingBox();
  expect(blockBox!.y).toBeLessThan(heading!.y);
});

test("a passage in it takes a comment that leaves the YAML as it was", async ({ page }) => {
  const path = resolve(TMP, "commented.md");
  writeFileSync(path, SOURCE);
  await open(page, path);
  const yaml = page.locator(".fm-editor-pane[data-active='true'] .fm-frontmatter-yaml");
  await expect(yaml).toContainText("What this file is for.");
  await yaml.evaluate((pre) => {
    const node = pre.firstChild as Text;
    const at = node.data.indexOf("What this file is for.");
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + "What this file is for.".length);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await expect(page.getByTestId("fm-selection-toolbar")).toBeVisible();
  // The front matter takes comments, not suggestions.
  await expect(page.getByTestId("fm-selection-suggest")).toHaveCount(0);
  await page.getByTestId("fm-selection-comment").click();
  await page.getByTestId("fm-composer-textarea").fill("Say what it is for in one line.");
  await page.getByTestId("fm-composer-textarea").press("Meta+Enter");

  const file = await savedFile(page, path);
  // The YAML, and the rest of the body, are byte for byte as they were.
  expect(file.startsWith(SOURCE)).toBe(true);
  const parsed = parseForgemarkFile(file);
  expect(parsed.comments[0]).toMatchObject({
    floating: true,
    anchor_frontmatter: true,
    anchor_text: "What this file is for.",
  });
  expect(lintText(file, "markdown").problems).toEqual([]);
  // Highlighted where it is, and listed with the attached comments.
  await expect(yaml.locator("[data-anchor-id='1']")).toHaveText("What this file is for.");
  await expect(page.getByTestId("fm-sidebar-section-floating")).toHaveCount(0);
});
