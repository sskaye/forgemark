import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIGHT, DARK } from "../../src/theme/tokens";

// Contract test: src/theme/tokens.ts must match the values in
// docs/design-tokens.js byte-for-byte. That file is the retained source
// snapshot from the design pass; production code translates it into TS.
//
// We re-derive the source values by extracting them with a small parser
// rather than executing the file (which expects a browser `window`).
//
// If this test fails, either the source moved (update src/theme/tokens.ts
// to match) or src/theme/tokens.ts drifted (revert it).

const SOURCE_PATH = resolve(__dirname, "..", "..", "docs", "design-tokens.js");

function extractObject(source: string, marker: string): Record<string, string> {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find marker ${marker} in tokens.js`);
  // Find the matching opening brace and pair it with its closing one.
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`Unbalanced braces after ${marker}`);
  const block = source.slice(open + 1, end);

  const out: Record<string, string> = {};
  // Strip line comments first so we don't pick them up as values.
  const lines = block.split("\n").map((l) => l.replace(/\/\/.*$/, ""));
  // Match `  key: "value",` or `  key: "value",  // comment` and concatenate
  // multi-line string values that the source breaks across lines.
  let buffer = "";
  for (const line of lines) {
    buffer += " " + line;
    const m = buffer.match(/(\w+):\s*("[^"]*"|'[^']*'|[^,\n}]+?)\s*,?\s*$/);
    if (m && (m[2].endsWith('"') || m[2].endsWith("'") || /^\d/.test(m[2].trim()))) {
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[m[1]] = value;
      buffer = "";
    }
  }
  return out;
}

const SOURCE = readFileSync(SOURCE_PATH, "utf-8");
const SOURCE_LIGHT = extractObject(SOURCE, "const LIGHT");
const SOURCE_DARK = extractObject(SOURCE, "const DARK");

describe("tokens contract", () => {
  it("LIGHT theme matches tokens.js", () => {
    for (const [key, expected] of Object.entries(SOURCE_LIGHT)) {
      const got = (LIGHT as unknown as Record<string, string>)[key];
      expect(got, `LIGHT.${key}`).toBe(expected);
    }
  });

  it("DARK theme matches tokens.js", () => {
    for (const [key, expected] of Object.entries(SOURCE_DARK)) {
      const got = (DARK as unknown as Record<string, string>)[key];
      expect(got, `DARK.${key}`).toBe(expected);
    }
  });

  it("LIGHT and DARK have the same keys", () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
  });
});
