import { describe, it, expect } from "vitest";
import { locateAnchor } from "../../../src/format/locate";
import { anchorTextMatches, normalizeAnchorText } from "../../../src/format/anchor-text";

// A backslash before punctuation in Markdown makes it literal: a reader
// sees `\<name>` as "<name>" and `\[x, y\]` as "[x, y]". A passage quoted
// that way wasn't found, and quoting the backslashes recorded `\<name>`
// as "\" — the `<name>` taken for a tag. Reported by ForgeGraph.

const DOC = [
  "file: auto *# The status file. auto: \\<name>.status.json beside this file.*",
  "",
  "areas: \\[\\[voltage, polarization\\],",
  "",
  "Use a\\_b and \\*star\\* here, or `a\\_b` in code.",
  "",
].join("\n");

describe("escaped punctuation in Markdown", () => {
  const cases: [quoted: string, source: string][] = [
    ["auto: <name>.status.json", "auto: \\<name>.status.json"],
    ["[[voltage, polarization],", "\\[\\[voltage, polarization\\],"],
    ["a_b and *star* here", "a\\_b and \\*star\\* here"],
  ];

  for (const [quoted, source] of cases) {
    it(`finds "${quoted}" as a reader sees it, and records that`, () => {
      const p = locateAnchor(DOC, quoted, "markdown");
      expect(DOC.slice(p.start, p.end)).toBe(source);
      expect(p.anchor_text).toBe(quoted);
    });

    it(`still finds it quoted with its backslashes: ${source}`, () => {
      const p = locateAnchor(DOC, source, "markdown");
      expect(DOC.slice(p.start, p.end)).toBe(source);
      expect(p.anchor_text).toBe(quoted);
    });
  }

  it("leaves a backslash in inline code as written", () => {
    expect(normalizeAnchorText("or `a\\_b` in code", "markdown")).toBe("or a\\_b in code");
  });

  it("reads a backslash at the end of a line as a line break", () => {
    const spec =
      "name: x          *# \\[text\\]; The name.*\\\nversion: 0          *# \\[int\\]*\n";
    expect(normalizeAnchorText(spec, "markdown")).toBe(
      "name: x # [text]; The name. version: 0 # [int]",
    );
  });

  it("accepts anchor text recorded the old way", () => {
    // 1.12.0 kept the backslash and lost the escaped <name>.
    expect(
      anchorTextMatches("auto: \\.status.json", "auto: \\<name>.status.json", "markdown"),
    ).toBe(true);
    expect(anchorTextMatches("\\[x, y\\];", "\\[x, y\\];", "markdown")).toBe(true);
    // And what the app records, the reader's text.
    expect(
      anchorTextMatches("auto: <name>.status.json", "auto: \\<name>.status.json", "markdown"),
    ).toBe(true);
  });
});
