// Comments on a passage that runs across two blocks — two paragraphs,
// list items, or table cells — in a real browser.
//
// A reader selects across blocks as readily as within one. The comment
// is kept, its markers sit in the two blocks, and it reads back as the
// words the reader saw; a suggestion is not offered, because accepting
// one would merge the blocks. In an HTML report the blocks may touch in
// the source (`<td>a</td><td>b</td>`), which a generated report often
// does and which used to turn the comment into a floating note.

import { test, expect, type Page, type Locator, type FrameLocator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { installTauriShim, type E2EState } from "./tauri-shim";
import { ROOT } from "./fixtures";
import { lintText } from "../../cli/lint";
import { parseForgemarkFile } from "../../src/format";

const TMP = resolve(ROOT, "tests", "e2e", ".tmp", "cross-block");
mkdirSync(TMP, { recursive: true });

function fixture(name: string, text: string): string {
  const path = resolve(TMP, name);
  writeFileSync(path, text);
  return path;
}

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

// Select from the start of the `nth` occurrence of `from` to the end of
// the next `to`, across nodes, as a drag would.
async function selectAcross(root: Locator, from: string, to: string, nth = 0) {
  await root.evaluate(
    (el, [from, to, nth]) => {
      const doc = el.ownerDocument;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let start: [Text, number] | null = null;
      let end: [Text, number] | null = null;
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        if (!start && n.data.includes(from as string)) {
          if (seen++ === nth) start = [n, n.data.indexOf(from as string)];
          else continue;
        }
        if (start && n.data.includes(to as string)) {
          const at =
            n === start[0] ? n.data.indexOf(to as string, start[1]) : n.data.indexOf(to as string);
          if (at >= 0) {
            end = [n, at + (to as string).length];
            break;
          }
        }
      }
      if (!start || !end) throw new Error(`selection not found: ${from}…${to}`);
      const range = doc.createRange();
      range.setStart(start[0], start[1]);
      range.setEnd(end[0], end[1]);
      start[0].parentElement?.scrollIntoView({ block: "center" });
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [from, to, nth] as const,
  );
}

async function commentOnToolbar(page: Page, text: string) {
  await expect(page.getByTestId("fm-selection-toolbar")).toBeVisible();
  // A passage across blocks takes a comment, never a suggestion.
  await expect(page.getByTestId("fm-selection-suggest")).toHaveCount(0);
  await page.getByTestId("fm-selection-comment").click();
  const box = page.getByTestId("fm-composer-textarea");
  await box.fill(text);
  await box.press("Meta+Enter");
  await expect(page.getByTestId("fm-composer")).not.toBeVisible();
}

function record(file: string, format: "markdown" | "html") {
  const parsed = parseForgemarkFile(file, { format });
  return { parsed, comment: parsed.comments[0], lint: lintText(file, format).problems };
}

test.describe("Markdown", () => {
  const prose = (page: Page) =>
    page.locator(".fm-editor-pane[data-active='true'] .fm-rendered-view .ProseMirror");

  test("a passage across two paragraphs is commented on, not suggested", async ({ page }) => {
    const path = fixture("paras.md", "Intro line.\n\nalpha one\n\nbeta two\n");
    await open(page, path);
    await expect(prose(page)).toContainText("beta two");
    // Focus the editor first, as the reader's drag would.
    await prose(page).click();
    await selectAcross(prose(page), "one", "beta");
    await commentOnToolbar(page, "Across paragraphs.");
    const file = await savedFile(page, path);
    expect(file).toContain("alpha <!-- fmc:1 -->one\n\nbeta<!-- /fmc:1 --> two");
    const { comment, lint } = record(file, "markdown");
    expect(comment.anchor_text).toBe("one beta");
    expect(lint).toEqual([]);
  });

  test("a passage across two list items reads back as the reader read it", async ({ page }) => {
    const path = fixture("list.md", "Intro line.\n\n- alpha one\n- beta two\n");
    await open(page, path);
    await expect(prose(page)).toContainText("beta two");
    // Focus the editor first, as the reader's drag would.
    await prose(page).click();
    await selectAcross(prose(page), "one", "beta");
    await commentOnToolbar(page, "Across items.");
    const file = await savedFile(page, path);
    expect(file).toContain("- alpha <!-- fmc:1 -->one\n- beta<!-- /fmc:1 --> two");
    const { comment, lint } = record(file, "markdown");
    expect(comment.anchor_text).toBe("one beta");
    expect(lint).toEqual([]);
  });
});

test.describe("HTML report", () => {
  const frameOf = (page: Page): FrameLocator => page.frameLocator("[data-testid='fm-html-view']");

  test("a passage across two blocks that touch in the source is anchored, not floated", async ({
    page,
  }) => {
    const path = fixture(
      "touching.html",
      "<!doctype html><html><body><p>Intro line.</p>\n<p>alpha one</p><p>beta two</p>\n</body></html>\n",
    );
    await open(page, path);
    const frame = frameOf(page);
    await expect(frame.locator("p").nth(2)).toHaveText("beta two");
    await selectAcross(frame.locator("body"), "one", "beta");
    await commentOnToolbar(page, "Across paragraphs.");
    const file = await savedFile(page, path);
    expect(file).toContain("<p>alpha <!-- fmc:1 -->one</p><p>beta<!-- /fmc:1 --> two</p>");
    const { comment, lint } = record(file, "html");
    expect(comment.floating).toBeUndefined();
    expect(comment.anchor_text).toBe("one beta");
    expect(lint).toEqual([]);
    // The highlight is the two words, not the gap between the blocks.
    await expect(frame.locator("[data-anchor-id='1']")).toHaveText(["one", "beta"]);
  });

  test("a comment on the first of two identical cells lands on the first", async ({ page }) => {
    const path = fixture(
      "cells.html",
      "<!doctype html><html><body><table><tr><td>x</td><td>beta two</td></tr>" +
        "<tr><td>y.</td><td>beta two</td></tr></table>\n</body></html>\n",
    );
    await open(page, path);
    const frame = frameOf(page);
    await expect(frame.locator("td").nth(3)).toHaveText("beta two");
    await selectAcross(frame.locator("body"), "beta", "two", 0);
    await expect(page.getByTestId("fm-selection-toolbar")).toBeVisible();
    await page.getByTestId("fm-selection-comment").click();
    await page.getByTestId("fm-composer-textarea").fill("The first one.");
    await page.getByTestId("fm-composer-textarea").press("Meta+Enter");
    const file = await savedFile(page, path);
    expect(file).toContain("<td>x</td><td><!-- fmc:1 -->beta two<!-- /fmc:1 --></td>");
  });

  // The fallback that the touching blocks above used to fall into
  // silently: text with no place in the source becomes a floating note,
  // and the composer now says so before the reader submits.
  test("a passage the report's script wrote says it will be a floating note", async ({ page }) => {
    const path = fixture(
      "scripted.html",
      '<!doctype html><html><body><p>Intro line.</p><div class="out"></div>\n' +
        "<script>document.querySelector('.out').textContent = 'Written by the script.';</script>\n" +
        "</body></html>\n",
    );
    await open(page, path);
    const frame = frameOf(page);
    await expect(frame.locator(".out")).toHaveText("Written by the script.");
    await selectAcross(frame.locator("body"), "Written", "script");
    await page.getByTestId("fm-selection-comment").click();
    await expect(page.getByTestId("fm-composer-notice")).toContainText("floating note");
    await expect(page.getByTestId("fm-composer-suggest-unavailable")).toHaveText(
      "Comment only — floating note",
    );
  });
});
