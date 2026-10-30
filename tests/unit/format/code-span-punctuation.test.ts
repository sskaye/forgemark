import { describe, it, expect } from "vitest";
import { locateAnchor } from "../../../src/format/locate";
import { parseForgemarkFile } from "../../../src/format";
import { replaceAnchoredText } from "../../../src/format/compose";
import { addComment } from "../../../cli/lib";

// An anchor running out of a code span into the text after it, where the
// code ends in punctuation and the text starts with it: "a:, and more"
// in "Use `a:`, and more." The closing backtick sits between two
// punctuation marks, where the matcher allowed no markup, so the passage
// wasn't found (sskaye/forgemark#37, from ForgeGraph).

const cases: [line: string, quoted: string, source: string][] = [
  ["Use `extend`, and more.", "extend, and more", "`extend`, and more"],
  ["Use `extends:` and more.", "extends: and more", "`extends:` and more"],
  ["Use `a:b`, and more.", "a:b, and more", "`a:b`, and more"],
  ["Use a:, and more.", "a:, and more", "a:, and more"],
  ["Use `a:`, and more.", "a:, and more", "`a:`, and more"],
  ["Use `a:`; and more.", "a:; and more", "`a:`; and more"],
  ["Use `a;`, and more.", "a;, and more", "`a;`, and more"],
];

describe("an anchor out of a code span ending in punctuation", () => {
  for (const [line, quoted, source] of cases) {
    it(`finds "${quoted}" in ${line}`, () => {
      const doc = line + "\n";
      const p = locateAnchor(doc, quoted, "markdown");
      expect(doc.slice(p.start, p.end)).toBe(source);
      expect(p.anchor_text).toBe(quoted);
    });
  }

  it("finds the passage ForgeGraph couldn't anchor", () => {
    const doc = "Any spec named in `extends:`, and finally the base.\n";
    const p = locateAnchor(doc, "named in extends:, and finally", "markdown");
    expect(doc.slice(p.start, p.end)).toBe("named in `extends:`, and finally");
  });

  it("accepting a suggestion there replaces exactly that source", () => {
    const file = parseForgemarkFile("Use `a:`, and more.\n", { tolerant: true });
    const r = addComment(file, "markdown", {
      author: "Claude",
      anchor: "a:, and more",
      suggest: "`a:` and others",
      now: "2026-10-30T12:00:00Z",
    });
    const c = r.file.comments.at(-1)!;
    expect(c.suggested_edit?.from).toBe("`a:`, and more");
    const accepted = replaceAnchoredText(r.file.body, c.id, c.suggested_edit!.to, "markdown");
    expect(accepted?.previousText).toBe("`a:`, and more");
    expect(accepted?.body).toBe("Use `a:` and others.\n");
  });
});
