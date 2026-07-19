// Bug 4 / report Bug 2 (splatter): coalesceAnchorMarkers merges the run of
// same-id pairs Tiptap emits for an anchored selection that spans inline
// formatting, down to a single pair.

import { describe, it, expect } from "vitest";
import { coalesceAnchorMarkers, bodyFromAnchorSpans } from "../../../src/format/markers-display";
import { parseForgemarkFile } from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import type { Comment } from "../../../src/format/types";

function opens(body: string, id: number): number {
  return (body.match(new RegExp(`<!--\\s*fmc:${id}\\s*-->`, "g")) ?? []).length;
}
function closes(body: string, id: number): number {
  return (body.match(new RegExp(`<!--\\s*/fmc:${id}\\s*-->`, "g")) ?? []).length;
}

describe("coalesceAnchorMarkers", () => {
  it("collapses a splattered run into exactly one pair", () => {
    // Real output captured from the Tiptap creation path (5 pairs).
    const splattered =
      "<!-- fmc:1 -->Fabrication is persistent: <!-- /fmc:1 -->*<!-- fmc:1 -->Scientific Reports" +
      "<!-- /fmc:1 -->*<!-- fmc:1 --> found \\~55% of <!-- /fmc:1 -->[<!-- fmc:1 -->citations" +
      "<!-- /fmc:1 -->](https://example.com/x)<!-- fmc:1 --> fabricated in one study.<!-- /fmc:1 -->";
    expect(opens(splattered, 1)).toBe(5); // precondition: splattered
    const out = coalesceAnchorMarkers(splattered);
    expect(opens(out, 1)).toBe(1);
    expect(closes(out, 1)).toBe(1);
    // First open and last close survive; inner markup is preserved between.
    expect(out.startsWith("<!-- fmc:1 -->Fabrication is persistent:")).toBe(true);
    expect(out).toContain("*Scientific Reports*");
    expect(out).toContain("[citations](https://example.com/x)");
    expect(out.endsWith("fabricated in one study.<!-- /fmc:1 -->")).toBe(true);
  });

  it("leaves a single clean pair untouched", () => {
    const body = "alpha <!-- fmc:2 -->bravo<!-- /fmc:2 --> charlie";
    expect(coalesceAnchorMarkers(body)).toBe(body);
  });

  it("does NOT merge across a different comment's markers", () => {
    // Two distinct ids adjacent — must remain two separate pairs.
    const body = "<!-- fmc:1 -->one<!-- /fmc:1 --> <!-- fmc:2 -->two<!-- /fmc:2 -->";
    expect(coalesceAnchorMarkers(body)).toBe(body);
    expect(opens(body, 1)).toBe(1);
    expect(opens(body, 2)).toBe(1);
  });

  it("the coalesced body parses cleanly (no Duplicate marker pair)", () => {
    const splattered = "<!-- fmc:1 -->a<!-- /fmc:1 -->*<!-- fmc:1 -->b<!-- /fmc:1 -->* end.";
    const body = coalesceAnchorMarkers(splattered);
    const record: Comment = {
      id: 1,
      anchor_text: "a*b* end fragment",
      context_before: "",
      context_after: "",
      author: "T",
      timestamp: "2026-06-21T00:00:00Z",
      resolved: false,
      body: "note",
    };
    const file = serializeForgemarkFile({ body, comments: [record] });
    expect(() => parseForgemarkFile(file)).not.toThrow();
  });

  it("bodyFromAnchorSpans applies the coalesce end-to-end", () => {
    const spans = '<span data-anchor-id="3">a</span>*<span data-anchor-id="3">b</span>*';
    const out = bodyFromAnchorSpans(spans);
    expect(opens(out, 3)).toBe(1);
    expect(closes(out, 3)).toBe(1);
  });
});
