// Reading and editing a Markdown document, in a real browser.
//
// The unit tests prove what the editor parses and writes back. What
// they cannot see is the page: that a keycap looks like a keycap, that
// Mermaid draws, that a wide table scrolls, that typing at the end of a
// paragraph reaches the file with everything else untouched.

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installTauriShim, type E2EState } from "./tauri-shim";
import { showcasePath } from "./fixtures";

const SHOWCASE = showcasePath();
const SOURCE = readFileSync(SHOWCASE, "utf8");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriShim);
});

async function openShowcase(page: Page) {
  await page.goto("http://localhost:1420/");
  await expect(page.getByTestId("fm-editor-pane")).toBeVisible();
  await page.evaluate((path) => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path } }));
  }, SHOWCASE);
  const prose = activeProse(page);
  await expect(prose.locator("h1")).toHaveText("GFM showcase");
  return prose;
}

// Background documents stay mounted; only the active pane is the page.
const activeProse = (page: Page) =>
  page.locator(".fm-editor-pane[data-active='true'] .fm-rendered-view .fm-prose");

// The file as last saved, once it holds `marker` (autosave writes after
// every pause, so the first write may be an earlier keystroke).
async function savedFile(page: Page, marker = ""): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ([path, marker]) => {
            const text = (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.files[
              path
            ];
            return text != null && text.includes(marker) ? text : null;
          },
          [SHOWCASE, marker] as const,
        ),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return page.evaluate(
    (path) => (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.files[path],
    SHOWCASE,
  );
}

test("renders what GitHub renders", async ({ page }) => {
  const prose = await openShowcase(page);
  // Inline HTML as elements, comments and word breaks as nothing.
  await expect(prose.locator("kbd")).toHaveCount(2);
  await expect(prose.locator("mark")).toHaveText("highlighted");
  await expect(prose.locator("abbr[title='subscript']")).toBeVisible();
  const red = prose.locator("span", { hasText: "red span" });
  expect(await red.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(215, 0, 21)");
  await expect(prose.locator("fm-html")).toHaveCount(2);
  // Images resolve against the file's folder.
  const src = await prose.locator("img").first().getAttribute("src");
  expect(src).toMatch(/\/@fs\/.*\/testing\/images\/swatch\.png$/);
  await expect(prose.locator("a img")).toHaveCount(1);
  const embed = prose.locator("img[data-wikilink='true']");
  await expect(embed).toHaveAttribute("alt", "Swatch");
  expect(await embed.getAttribute("src")).toMatch(/\/@fs\/.*\/testing\/images\/swatch\.png$/);
  // Raw HTML blocks render; the block comment keeps a placeholder.
  await expect(prose.locator(".fm-html-block p[align='center'] img")).toBeVisible();
  await expect(prose.locator(".fm-html-block table td")).toHaveCount(2);
  await expect(prose.locator(".fm-html-block details summary")).toHaveText("More detail");
  // The lone closing tag and the block comment keep placeholders.
  await expect(prose.locator(".fm-verbatim-label")).toHaveText(["HTML", "HTML comment"]);
  // Alerts, footnotes, strikethrough, links.
  await expect(prose.locator("blockquote[data-alert='note']")).toBeVisible();
  await expect(prose.locator("blockquote[data-alert='warning']")).toBeVisible();
  await expect(prose.locator("blockquote[data-alert='generic']")).toHaveAttribute(
    "data-alert-label",
    "Takeaway",
  );
  await expect(prose.locator("blockquote:not([data-alert])")).toHaveCount(1);
  await expect(prose.locator("sup.fm-footnote-ref")).toHaveText(["[1]", "[note]"]);
  await expect(prose.locator(".fm-footnote-def")).toHaveCount(2);
  await expect(prose.locator("s")).toHaveText(["one tilde", "two"]);
  const hrefs = await prose
    .locator("h2#links ~ p a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual([
    "https://example.com/a_b?c=1",
    "http://www.example.com",
    "mailto:mail@example.com",
    "https://example.com",
  ]);
  // Tables: an escaped pipe shows as a pipe; the wide one scrolls.
  await expect(prose.locator(".tableWrapper table").first().locator("td").nth(3)).toHaveText(
    "x | y",
  );
  const wide = prose.locator(".tableWrapper").nth(1);
  const overflow = await wide.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(true);
  // Code, math, diagram, task list.
  await expect(prose.locator("pre .hljs-keyword").first()).toHaveText("def");
  await expect(prose.locator("pre").nth(1).locator("[class^='hljs-']")).toHaveCount(0);
  await expect(prose.locator(".fm-math .katex")).toBeVisible();
  await expect(prose.locator(".fm-math-block .katex-display")).toHaveCount(2);
  await expect(prose.locator(".fm-mermaid svg")).toBeVisible({ timeout: 20_000 });
  await expect(prose.locator("ul[data-type='taskList'] input:checked")).toHaveCount(1);
  // Headings carry GitHub's ids.
  await expect(prose.locator("h2#inline-html")).toBeVisible();
});

test("an edit reaches the file with everything else untouched", async ({ page }) => {
  const prose = await openShowcase(page);
  const paragraph = prose.locator("p", { hasText: "Press" }).first();
  await paragraph.click();
  // The caret at the very end of the paragraph, whatever line it wraps on.
  await paragraph.evaluate((p) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    const selection = window.getSelection()!;
    selection.collapse(last, last!.data.length);
  });
  await page.waitForTimeout(50);
  await page.keyboard.type(" Done.");
  const file = await savedFile(page, "word break. Done.");
  const changed = "a<wbr>b has a word break. Done.";
  expect(file).toContain(changed);
  expect(file).toContain("<kbd>Ctrl</kbd>+<kbd>C</kbd>");
  expect(file).toContain('<abbr title="subscript">sub</abbr>');
  expect(file).toContain('<span style="color: #d70015">red span</span>');
  expect(file).toContain("<!-- an inline comment -->");
  // Only that paragraph changed.
  expect(file.replace(changed, "a<wbr>b has a word break.")).toBe(SOURCE);
});

test("in-document links scroll and document links open a tab", async ({ page }) => {
  const prose = await openShowcase(page);
  const pane = page.getByTestId("fm-editor-pane");
  const before = await pane.evaluate((el) => el.scrollTop);
  await prose.locator("a[href='#inline-html']").click();
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);

  await prose.locator("a[href='./linked.md']").click();
  await expect(page.getByRole("tab", { name: /linked\.md/ })).toBeVisible();
  await expect(activeProse(page).locator("h1")).toHaveText("Linked document");

  await activeProse(page).locator("a[href='./gfm-showcase.md#links']").click();
  await expect(page.getByRole("tab", { name: /gfm-showcase\.md/, selected: true })).toBeVisible();
  await expect(activeProse(page).locator("h1")).toHaveText("GFM showcase");

  await activeProse(page).locator("a[href='https://example.com']").first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __forgemark_e2e: E2EState }).__forgemark_e2e.opened,
      ),
    )
    .toContainEqual({ kind: "url", target: "https://example.com/" });
});

test("a comment on a passage splices markers and nothing else", async ({ page }) => {
  const prose = await openShowcase(page);
  // A double-click selects the word, as a reader would.
  await prose.locator("mark").dblclick();
  await expect(page.getByTestId("fm-selection-toolbar")).toBeVisible();
  await page.getByTestId("fm-selection-comment").click();
  const box = page.getByTestId("fm-composer-textarea");
  await box.fill("Is this the right word?");
  await box.press("Meta+Enter");
  await expect(prose.locator("[data-anchor-id='1']")).toHaveText("highlighted");
  const file = await savedFile(page);
  // The locator places the markers around the words, inside the tag.
  expect(file).toContain("<mark><!-- fmc:1 -->highlighted<!-- /fmc:1 --></mark>");
  expect(file).toContain("<!-- forgemark-comments");
  const body = file.slice(0, file.indexOf("\n<!-- forgemark-comments"));
  expect(body.replace("<!-- fmc:1 -->", "").replace("<!-- /fmc:1 -->", "").trimEnd()).toBe(
    SOURCE.trimEnd(),
  );
});

test("typing beside an anchor's edges keeps the markers where they were", async ({ page }) => {
  const prose = await openShowcase(page);
  await prose.locator("mark").dblclick();
  await expect(page.getByTestId("fm-selection-toolbar")).toBeVisible();
  await page.getByTestId("fm-selection-comment").click();
  const box = page.getByTestId("fm-composer-textarea");
  await box.fill("Word choice.");
  await box.press("Meta+Enter");
  await expect(prose.locator("[data-anchor-id='1']")).toHaveText("highlighted");

  // Caret just after the close edge, placed through the editor, then
  // Backspace: the last anchored letter goes, the edge stays.
  await page.evaluate(() => {
    const dom = document.querySelector(".fm-editor-pane[data-active='true'] .ProseMirror");
    const editor = (
      dom as unknown as {
        __forgemarkEditor: {
          state: {
            doc: {
              descendants(
                f: (n: { type: { name: string }; attrs: { edge: string } }, pos: number) => void,
              ): void;
            };
          };
          commands: { setTextSelection(pos: number): void };
          view: { focus(): void };
        };
      }
    ).__forgemarkEditor;
    let after = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "anchorEdge" && node.attrs.edge === "close") after = pos + 1;
    });
    editor.commands.setTextSelection(after);
    editor.view.focus();
  });
  await page.keyboard.press("Backspace");
  await expect(prose.locator("[data-anchor-id='1']")).toHaveText("highlighte");
  await page.keyboard.type("d!");
  const file = await savedFile(page, "highlighte<!-- /fmc:1 -->d!");
  expect(file).toContain("<mark><!-- fmc:1 -->highlighte<!-- /fmc:1 -->d!</mark>");
});

test("what is typed in Source view is what the file gets, and Rendered shows it", async ({
  page,
}) => {
  const prose = await openShowcase(page);
  await page.getByRole("tab", { name: "Source" }).click();
  const host = page.getByTestId("fm-source-view");
  await expect(host).toBeVisible();
  await expect(page.getByTestId("fm-source-chip")).toContainText("editable");
  // Type through the editor itself: the caret after the title line.
  await host.evaluate((el) => {
    const view = (el as unknown as { __forgemarkSourceView: import("@codemirror/view").EditorView })
      .__forgemarkSourceView;
    const text = view.state.doc.toString();
    const at = text.indexOf("# GFM showcase\n") + "# GFM showcase\n".length;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
  });
  await page.keyboard.type("\nTyped in Source view.\n");
  // The title line already ends in a blank line, so one Enter each side.
  const expected = SOURCE.replace("# GFM showcase\n", "# GFM showcase\n\nTyped in Source view.\n");
  expect(await savedFile(page, "Typed in Source view.\n\n")).toBe(expected);
  await page.getByRole("tab", { name: "Rendered" }).click();
  await expect(prose.locator("p", { hasText: "Typed in Source view." })).toBeVisible();
  // Leaving Source view rewrote no other block.
  await page.waitForTimeout(1500);
  expect(await savedFile(page, "Typed in Source view.\n\n")).toBe(expected);
});
