// The load-bearing guarantee, in HTML.
//
// Forgemark's hardest gate is that parse → serialize returns the
// original bytes. It is what keeps `git diff` readable and what stops
// the app from churning a file it was only asked to read. HTML support
// is only worth building if that gate holds unchanged, so it is checked
// here against the real generated report rather than a fixture written
// to be easy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseForgemarkFile, ForgemarkParseError } from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import { classifyAnchors, findCandidates } from "../../../src/format/reattach";
import { insertMarkersIntoBody, replaceAnchoredText } from "../../../src/format/compose";
import { buildHtmlTextMap, textRangeToSource } from "../../../src/format/html/textmap";
import { detectFormat } from "../../../src/format/types";
import type { Comment } from "../../../src/format/types";

const report = readFileSync(resolve(__dirname, "..", "..", "fixtures", "report.html"), "utf-8");

const BLOCK = `<!-- forgemark-comments
- id: 1
  anchor_text: "variable projection"
  author: Claude
  timestamp: 2026-08-16T09:00:00Z
  resolved: false
  body: |
    Worth a one-line gloss for readers who don't know the method.
-->
`;

// Anchor a phrase in the report by mapping rendered text to source and
// splicing markers — the same path the editor takes on a selection.
function anchorPhrase(html: string, phrase: string, id: number): string {
  const map = buildHtmlTextMap(html);
  const at = map.text.indexOf(phrase);
  const span = textRangeToSource(map, at, at + phrase.length, { requireExact: true });
  if (!span) throw new Error(`could not map ${phrase}`);
  return insertMarkersIntoBody(html, span.start, span.end, id);
}

describe("html round-trip", () => {
  const anchored = anchorPhrase(report, "variable projection", 1);
  const file = anchored.replace(/\s*$/, "") + "\n\n" + BLOCK;

  it("splices markers around the rendered phrase, in the source", () => {
    expect(anchored).toContain("<!-- fmc:1 -->variable projection<!-- /fmc:1 -->");
    // Everything else is byte-identical; only the two markers were added.
    expect(anchored.replace("<!-- fmc:1 -->", "").replace("<!-- /fmc:1 -->", "")).toBe(report);
  });

  it("parses and re-serializes byte-identically", () => {
    const parsed = parseForgemarkFile(file, { format: "html" });
    expect(parsed.comments).toHaveLength(1);
    expect(serializeForgemarkFile(parsed)).toBe(file);
  });

  it("emits no trailing block when there are no comments", () => {
    const parsed = parseForgemarkFile(report, { format: "html" });
    expect(parsed.comments).toEqual([]);
    expect(serializeForgemarkFile(parsed)).toBe(report);
  });

  it("classifies the anchor as attached", () => {
    const parsed = parseForgemarkFile(file, { format: "html" });
    const statuses = classifyAnchors(parsed.body, parsed.comments, "html");
    expect(statuses.get(1)?.kind).toBe("attached");
  });

  it("still enforces the marker ↔ record invariant", () => {
    // A marker with no YAML record is corruption in HTML exactly as it
    // is in Markdown, and must not pass silently.
    const orphanMarker = anchorPhrase(report, "profile likelihood", 99);
    const bad = orphanMarker.replace(/\s*$/, "") + "\n\n" + BLOCK;
    expect(() => parseForgemarkFile(bad, { format: "html" })).toThrow(ForgemarkParseError);
  });

  it("accepts a suggestion by replacing the anchored text in place", () => {
    const parsed = parseForgemarkFile(file, { format: "html" });
    const result = replaceAnchoredText(parsed.body, 1, "variable projection (VarPro)", "html");
    expect(result).not.toBeNull();
    expect(result!.previousText).toBe("variable projection");
    expect(result!.body).toContain("<b>variable projection (VarPro)</b>");
    expect(result!.body).not.toContain("fmc:1");
  });
});

describe("html reattachment after a regenerated report", () => {
  // The dominant HTML workflow: the agent reruns and writes a whole new
  // file, so the markers are gone but the prose survives. The comment
  // must be recoverable, which means matching against rendered text —
  // matching raw source finds nothing useful here.
  const orphan: Comment = {
    id: 1,
    anchor_text: "variable projection",
    context_before: "minimising over the rest is",
    context_after: "(Golub",
    author: "Claude",
    timestamp: "2026-08-16T09:00:00Z",
    resolved: false,
    body: "Gloss this.",
  };

  it("finds the passage in a report with no markers left", () => {
    const candidates = findCandidates(report, orphan, "html");
    expect(candidates.length).toBeGreaterThan(0);
    const best = candidates[0];
    expect(report.slice(best.from, best.to)).toBe("variable projection");
    expect(best.rationale).toMatch(/exact/);
  });

  it("returns offsets that splice back into valid markers", () => {
    const best = findCandidates(report, orphan, "html")[0];
    const reattached = insertMarkersIntoBody(report, best.from, best.to, 1);
    const file = reattached.replace(/\s*$/, "") + "\n\n" + BLOCK;
    const parsed = parseForgemarkFile(file, { format: "html" });
    expect(classifyAnchors(parsed.body, parsed.comments, "html").get(1)?.kind).toBe("attached");
  });

  it("recovers a passage split across inline tags", () => {
    // `<code>ISF</code> from this record` — the anchor spans a tag
    // boundary, so it exists in the rendered text but never appears
    // contiguously in the source.
    const split: Comment = { ...orphan, anchor_text: "ISF from this record" };
    expect(report).not.toContain("ISF from this record");
    const candidates = findCandidates(report, split, "html");
    expect(candidates.length).toBeGreaterThan(0);
    expect(report.slice(candidates[0].from, candidates[0].to)).toBe("ISF</code> from this record");
  });

  it("finds nothing when the passage is genuinely gone", () => {
    const vanished: Comment = { ...orphan, anchor_text: "a sentence that was deleted entirely" };
    expect(findCandidates(report, vanished, "html")).toEqual([]);
  });
});

describe("detectFormat", () => {
  it("recognises html by extension and defaults to markdown", () => {
    expect(detectFormat("/tmp/report.html")).toBe("html");
    expect(detectFormat("report.HTM")).toBe("html");
    expect(detectFormat("notes.md")).toBe("markdown");
    expect(detectFormat("README")).toBe("markdown");
    expect(detectFormat(null)).toBe("markdown");
  });
});
