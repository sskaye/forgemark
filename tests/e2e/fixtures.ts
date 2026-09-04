// Fixtures for the browser tests: the test dashboard, made
// self-contained so it runs from a blob URL, which has no folder for a
// stylesheet or a data file to load from.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = resolve(ROOT, "docs", "example_file", "testing", "dashboard");
const TMP = resolve(ROOT, "tests", "e2e", ".tmp");

// The dashboard as committed, whatever a test run in the app may have
// left in the working copy: any markers and comments block are dropped.
function cleanSource(html: string): string {
  const at = html.indexOf("<!-- forgemark-comments");
  const body = at >= 0 ? html.slice(0, at) : html;
  return body.replace(/<!--\s*\/?fmc:\d+\s*-->/g, "").replace(/\n+$/, "\n");
}

export function writeInlineDashboard(): string {
  const html = cleanSource(readFileSync(resolve(SOURCE, "dashboard.html"), "utf8"));
  const css = readFileSync(resolve(SOURCE, "style.css"), "utf8");
  const data = readFileSync(resolve(SOURCE, "data.json"), "utf8");
  const inline = html
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`)
    .replace('fetch("data.json").then((r) => r.json())', `Promise.resolve(${data.trim()})`)
    .replace('<img src="logo.png" alt="logo">', "");
  if (inline === html) throw new Error("dashboard fixture did not match the expected source");
  mkdirSync(TMP, { recursive: true });
  const path = resolve(TMP, "dashboard.html");
  writeFileSync(path, inline);
  return path;
}

export function showcasePath(): string {
  return resolve(ROOT, "docs", "example_file", "testing", "gfm-showcase.md");
}
