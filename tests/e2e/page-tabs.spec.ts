// A report's own tabs, written as links to ids that a short script shows
// by the address's fragment, as ForgeGraph writes its dashboards
// (`lab_throughput.html`). The bridge used to cancel every link click and
// scroll to the target itself, so the fragment never changed and the
// tabs never switched.

import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { installTauriShim } from "./tauri-shim";
import { ROOT } from "./fixtures";

const TMP = resolve(ROOT, "tests", "e2e", ".tmp", "page-tabs");
mkdirSync(TMP, { recursive: true });

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Lab throughput</title>
<style>
  body.tabbed section { display: none; }
  body.tabbed section.shown { display: block; }
  .spacer { height: 1600px; }
</style></head>
<body>
<nav role="tablist">
<a role="tab" href="#overview">Overview</a>
<a role="tab" href="#by-instrument">By instrument</a>
<a id="handled" href="#by-instrument">Handled by the page</a>
</nav>
<section id="overview"><h2>Overview</h2><p>Weekly throughput.</p></section>
<section id="by-instrument"><h2>By instrument</h2><div class="spacer"></div>
<p>Runs per week on <!-- fmc:1 -->HPLC-02<!-- /fmc:1 -->.</p></section>
<details><summary>Notes</summary><p>Collected by <!-- fmc:2 -->the night shift<!-- /fmc:2 -->.</p></details>
<script>
(function () {
  var sections = document.querySelectorAll("section");
  var links = document.querySelectorAll("nav a[role=tab]");
  document.body.classList.add("tabbed");
  function show() {
    var id = decodeURIComponent(location.hash.slice(1)) || sections[0].id;
    if (!document.getElementById(id)) id = sections[0].id;
    sections.forEach(function (s) { s.classList.toggle("shown", s.id === id); });
    links.forEach(function (a) {
      a.setAttribute("aria-selected", a.getAttribute("href") === "#" + id ? "true" : "false");
    });
  }
  window.addEventListener("hashchange", show);
  show();
  document.getElementById("handled").addEventListener("click", function (e) {
    e.preventDefault();
    document.body.dataset.handled = "yes";
  });
})();
</script>
</body></html>
<!-- forgemark-comments
- id: 1
  anchor_text: "HPLC-02"
  author: Reviewer
  timestamp: 2026-10-25T00:00:00Z
  resolved: false
  body: "Which column?"
- id: 2
  anchor_text: "the night shift"
  author: Reviewer
  timestamp: 2026-10-25T00:00:00Z
  resolved: false
  body: "Which night?"
-->
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTauriShim);
});

async function open(page: Page, name: string): Promise<FrameLocator> {
  const path = resolve(TMP, name);
  writeFileSync(path, PAGE);
  await page.goto("http://localhost:1420/");
  await expect(page.getByTestId("fm-editor-pane").first()).toBeVisible();
  await page.evaluate((p) => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path: p } }));
  }, path);
  const frame = page.frameLocator("[data-testid='fm-html-view']");
  await expect(frame.locator("#overview")).toBeVisible();
  return frame;
}

test("a page's tabs switch when one is clicked", async ({ page }) => {
  const frame = await open(page, "switch.html");
  await expect(frame.locator("#by-instrument")).toBeHidden();
  await frame.getByRole("tab", { name: "By instrument" }).click();
  await expect(frame.locator("#by-instrument")).toBeVisible();
  await expect(frame.locator("#overview")).toBeHidden();
  await expect(frame.getByRole("tab", { name: "By instrument" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await frame.getByRole("tab", { name: "Overview" }).click();
  await expect(frame.locator("#overview")).toBeVisible();
});

test("a link the page handles itself is left to it", async ({ page }) => {
  const frame = await open(page, "handled.html");
  await frame.locator("#handled").click();
  await expect(frame.locator("body")).toHaveAttribute("data-handled", "yes");
  await expect(frame.locator("#by-instrument")).toBeHidden();
  expect(await frame.locator("body").evaluate(() => window.location.hash)).toBe("");
});

test("a comment in a hidden tab is listed, and its card shows the tab", async ({ page }) => {
  const frame = await open(page, "hidden-tab.html");
  await expect(page.getByTestId("fm-card-1")).toBeVisible();
  await expect(frame.locator("[data-anchor-id='1']").first()).toBeHidden();
  await page.getByTestId("fm-card-1").click();
  await expect(frame.locator("#by-instrument")).toBeVisible();
  await expect(frame.locator("[data-anchor-id='1']").first()).toBeInViewport();
});

test("a comment in a closed <details> opens it", async ({ page }) => {
  const frame = await open(page, "details.html");
  await expect(frame.locator("[data-anchor-id='2']").first()).toBeHidden();
  await page.getByTestId("fm-card-2").click();
  await expect(frame.locator("details")).toHaveAttribute("open", "");
  await expect(frame.locator("[data-anchor-id='2']").first()).toBeVisible();
});
