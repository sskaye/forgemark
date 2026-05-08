import { describe, it, expect } from "vitest";
import {
  parseForgemarkFile,
  serializeForgemarkFile,
  ForgemarkParseError,
} from "../../../src/format";

describe("parseForgemarkFile", () => {
  it("returns the input as body when there is no comment block", () => {
    const text = "# Hello\n\nWorld\n";
    const parsed = parseForgemarkFile(text);
    expect(parsed.body).toBe(text);
    expect(parsed.comments).toEqual([]);
  });

  it("parses a single anchored comment", () => {
    const text = [
      "Some prose with <!-- fmc:1 -->the anchored bit<!-- /fmc:1 --> in it.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "the anchored bit"',
      "  author: Steven",
      "  timestamp: 2026-05-07T14:32:00Z",
      "  resolved: false",
      "  body: |",
      "    A comment.",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments).toHaveLength(1);
    const c = parsed.comments[0];
    expect(c.id).toBe(1);
    expect(c.author).toBe("Steven");
    expect(c.anchor_text).toBe("the anchored bit");
    expect(c.body).toBe("A comment.\n");
    expect(c.resolved).toBe(false);
  });

  it("parses replies in chronological order", () => {
    const text = [
      "Anchored: <!-- fmc:1 -->x<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: Maya",
      "  timestamp: 2026-05-07T09:00:00Z",
      "  resolved: false",
      "  body: |",
      "    First.",
      "  replies:",
      "    - author: Claude",
      "      timestamp: 2026-05-07T09:30:00Z",
      "      body: |",
      "        Reply one.",
      "    - author: Maya",
      "      timestamp: 2026-05-07T10:00:00Z",
      "      body: |",
      "        Reply two.",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].replies).toHaveLength(2);
    expect(parsed.comments[0].replies?.[0].body).toBe("Reply one.\n");
    expect(parsed.comments[0].replies?.[1].body).toBe("Reply two.\n");
  });

  it("parses suggested edits", () => {
    const text = [
      "Original: <!-- fmc:1 -->bad phrase<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "bad phrase"',
      "  author: Maya",
      "  timestamp: 2026-05-07T14:00:00Z",
      "  resolved: false",
      "  body: |",
      "    Tighter.",
      "  suggested_edit:",
      '    from: "bad phrase"',
      '    to: "good phrase"',
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].suggested_edit).toEqual({
      from: "bad phrase",
      to: "good phrase",
    });
  });

  it("parses floating notes (no markers, no anchor_text)", () => {
    const text = [
      "Plain prose with no markers.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      "  floating: true",
      "  author: Devon",
      "  timestamp: 2026-05-08T11:00:00Z",
      "  resolved: false",
      "  body: |",
      "    A general note.",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].floating).toBe(true);
    expect(parsed.comments[0].anchor_text).toBeUndefined();
  });

  it("preserves unknown top-level fields on parse", () => {
    const text = [
      "Plain prose.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      "  floating: true",
      "  author: Devon",
      "  timestamp: 2026-05-08T11:00:00Z",
      "  resolved: false",
      "  body: |",
      "    Note.",
      '  custom_priority: "high"',
      "  custom_tags:",
      '    - "design"',
      '    - "research"',
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].additionalKeys).toEqual({
      custom_priority: "high",
      custom_tags: ["design", "research"],
    });
  });

  it("unescapes -->", () => {
    const text = [
      "x <!-- fmc:1 -->anchor<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "anchor"',
      "  author: A",
      "  timestamp: 2026-05-07T14:00:00Z",
      "  resolved: false",
      "  body: |",
      "    See --\\> for the arrow.",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].body).toBe("See --> for the arrow.\n");
  });

  it("unescapes <!--", () => {
    const text = [
      "x <!-- fmc:1 -->anchor<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "anchor"',
      "  author: A",
      "  timestamp: 2026-05-07T14:00:00Z",
      "  resolved: false",
      "  body: |",
      "    HTML opens with <!\\-- like this.",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].body).toBe("HTML opens with <!-- like this.\n");
  });
});

describe("validation invariants", () => {
  it("rejects duplicate ids", () => {
    const text = [
      "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "a"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    one",
      "- id: 1",
      '  anchor_text: "b"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    duplicate id",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/id 1 appears more than once/);
  });

  it("rejects YAML record with no marker pair (and not floating)", () => {
    const text = [
      "Body with no markers at all.",
      "",
      "<!-- forgemark-comments",
      "- id: 99",
      '  anchor_text: "missing"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    no markers",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/id 99 has no inline marker pair/);
  });

  it("tolerant mode: keeps non-floating comments whose markers are missing (Phase 9)", () => {
    const text = [
      "Body with no markers at all.",
      "",
      "<!-- forgemark-comments",
      "- id: 99",
      '  anchor_text: "missing"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    no markers",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text, { tolerant: true });
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].id).toBe(99);
    // Sanity: in tolerant mode the body stays as-is and no markers
    // were synthesised — the lost-anchor banner does the recovery.
    expect(parsed.body).not.toContain("fmc:99");
  });

  it("tolerant mode still rejects unmatched markers + duplicate ids (real corruption)", () => {
    // Unmatched: open without close
    const dangling = [
      "Body with <!-- fmc:1 -->no close here.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    one",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(dangling, { tolerant: true })).toThrow(/Unmatched open marker/);
  });

  it("rejects marker pair with no YAML record", () => {
    const text = [
      "Body has <!-- fmc:1 -->x<!-- /fmc:1 --> and <!-- fmc:2 -->y<!-- /fmc:2 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    one",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/id 2.*no YAML record/i);
  });

  it("rejects unmatched markers (open without close)", () => {
    const text = [
      "Body with <!-- fmc:1 -->no close here.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    one",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/Unmatched open marker/);
  });

  it("requires anchor_text when floating is unset", () => {
    const text = [
      "<!-- fmc:1 -->x<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    no anchor_text",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/anchor_text.*required/);
  });

  it("allows omitting anchor_text when floating is true", () => {
    const text = [
      "Plain prose, no markers.",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      "  floating: true",
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  body: |",
      "    floats",
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].floating).toBe(true);
  });

  it("requires body for plain comments", () => {
    const text = [
      "<!-- fmc:1 -->x<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(/body.*required/);
  });

  it("allows missing body when suggested_edit is present", () => {
    const text = [
      "<!-- fmc:1 -->x<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "- id: 1",
      '  anchor_text: "x"',
      "  author: A",
      "  timestamp: 2026-05-07T00:00:00Z",
      "  resolved: false",
      "  suggested_edit:",
      '    from: "x"',
      '    to: "y"',
      "-->",
      "",
    ].join("\n");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].body).toBeUndefined();
    expect(parsed.comments[0].suggested_edit).toEqual({ from: "x", to: "y" });
  });

  it("rejects malformed YAML with a helpful error", () => {
    const text = [
      "<!-- fmc:1 -->x<!-- /fmc:1 -->",
      "",
      "<!-- forgemark-comments",
      "this isn't a list",
      "-->",
      "",
    ].join("\n");
    expect(() => parseForgemarkFile(text)).toThrow(ForgemarkParseError);
  });
});

describe("serializeForgemarkFile", () => {
  it("emits the body unchanged when there are no comments", () => {
    const file = { body: "# Hello\n", comments: [] };
    expect(serializeForgemarkFile(file)).toBe("# Hello\n");
  });

  it("appends the trailing block when there are comments", () => {
    const body = "Some <!-- fmc:1 -->thing<!-- /fmc:1 --> here.\n";
    const file = {
      body,
      comments: [
        {
          id: 1,
          anchor_text: "thing",
          author: "Steven",
          timestamp: "2026-05-07T14:32:00Z",
          resolved: false,
          body: "A note.\n",
        },
      ],
    };
    const out = serializeForgemarkFile(file);
    expect(out).toContain("<!-- forgemark-comments\n");
    expect(out).toContain("- id: 1\n");
    // Single-word strings that are bare-safe come out unquoted; that's the
    // canonical form. Multi-word strings get double-quoted.
    expect(out).toContain("anchor_text: thing");
    expect(out).toContain("timestamp: 2026-05-07T14:32:00Z");
    expect(out.endsWith("-->\n")).toBe(true);
  });

  it("does not emit an empty block for clean files", () => {
    expect(serializeForgemarkFile({ body: "x\n", comments: [] })).toBe("x\n");
  });
});

describe("round-trip on hand-built inputs", () => {
  it("body + comment round-trips with deep equality", () => {
    const original = {
      body: "Anchored: <!-- fmc:1 -->the bit<!-- /fmc:1 --> here.\n",
      comments: [
        {
          id: 1,
          anchor_text: "the bit",
          context_before: "Anchored: ",
          context_after: " here.",
          author: "Steven",
          timestamp: "2026-05-07T14:32:00Z",
          resolved: false,
          body: "A multi-line\nbody.\n",
        },
      ],
    };
    const text = serializeForgemarkFile(original);
    const reparsed = parseForgemarkFile(text);
    expect(reparsed.comments).toEqual(original.comments);
    // Body match modulo the spacing between body and block (parser
    // returns body up to the block sentinel).
    expect(reparsed.body.trimEnd()).toBe(original.body.trimEnd());
  });

  it("reserialization is byte-identical (round-trip parity)", () => {
    const original = {
      body: "Anchored: <!-- fmc:1 -->bit<!-- /fmc:1 --> here.\n",
      comments: [
        {
          id: 1,
          anchor_text: "bit",
          author: "S",
          timestamp: "2026-05-07T14:32:00Z",
          resolved: false,
          body: "B.\n",
        },
      ],
    };
    const once = serializeForgemarkFile(original);
    const twice = serializeForgemarkFile(parseForgemarkFile(once));
    expect(twice).toBe(once);
  });
});
