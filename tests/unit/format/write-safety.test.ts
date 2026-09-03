import { describe, it, expect } from "vitest";
import {
  parseForgemarkFile,
  serializeForgemarkFile,
  recoverForgemarkFile,
  findStrayBlock,
  normalizeAnchorText,
  anchorTextMatches,
  ForgemarkParseError,
  ForgemarkSerializeError,
} from "../../../src/format";
import type { Comment } from "../../../src/format/types";

// The failures a heavy review cycle reported: each one hid every comment
// in a file, and three of the four were invisible until a reviewer said
// "I can't see the comments". These tests pin the write-side guards.

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    anchor_text: "an anchored passage",
    author: "Steven",
    timestamp: "2026-05-07T14:32:00Z",
    resolved: false,
    body: "Should this be tightened?\n",
    ...over,
  };
}

const BODY = "Some prose with <!-- fmc:1 -->an anchored passage<!-- /fmc:1 --> and more.\n";

describe("block scalars whose first line starts with whitespace", () => {
  // An anchor that crosses a hard-wrapped line carries the source's own
  // leading spaces on its continuation. Emitted as a block literal, the
  // deeper first line set the scalar's indentation and the shallower
  // second line ended it early — invalid YAML.
  const wrapped = " the evening and the\nsmall hours.";

  it("are written in a form the parser reads back", () => {
    const text = serializeForgemarkFile({
      body: BODY,
      comments: [comment({ anchor_text: wrapped })],
    });
    expect(text).toContain('anchor_text: " the evening and the\\nsmall hours."');
    const back = parseForgemarkFile(text);
    expect(back.comments[0].anchor_text).toBe(wrapped);
  });

  it("still uses a block literal when the first line is flush", () => {
    const text = serializeForgemarkFile({
      body: BODY,
      comments: [comment({ body: "first line\n  indented second line\n" })],
    });
    expect(text).toContain("body: |\n    first line\n      indented second line\n");
    expect(parseForgemarkFile(text).comments[0].body).toBe("first line\n  indented second line\n");
  });

  it("handles a leading blank line followed by an indented one", () => {
    const value = "\n  indented after blank\nthen flush\n";
    const text = serializeForgemarkFile({ body: BODY, comments: [comment({ body: value })] });
    expect(parseForgemarkFile(text).comments[0].body).toBe(value);
  });

  it("round-trips a reply body with the same shape", () => {
    const text = serializeForgemarkFile({
      body: BODY,
      comments: [
        comment({
          replies: [{ author: "Claude", timestamp: "2026-05-07T15:00:00Z", body: " x\ny\n" }],
        }),
      ],
    });
    expect(parseForgemarkFile(text).comments[0].replies?.[0].body).toBe(" x\ny\n");
  });
});

describe("parse errors name the line and the record", () => {
  const file =
    "# Doc\n\nProse <!-- fmc:6 -->x<!-- /fmc:6 -->.\n\n<!-- forgemark-comments\n" +
    "- id: 5\n  floating: true\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: ok\n" +
    "- id: 6\n  anchor_text: |\n     the evening and the\n    small hours.\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: x\n" +
    "-->\n";

  it("carries the file line and the comment id", () => {
    let caught: unknown;
    try {
      parseForgemarkFile(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForgemarkParseError);
    const e = caught as ForgemarkParseError;
    expect(e.kind).toBe("yaml");
    expect(e.line).toBe(15);
    expect(e.commentId).toBe(6);
    expect(e.message).toMatch(/line 15 \(comment id 6\)/);
  });

  it("surfaces the same message from the fail-soft loader", () => {
    const recovery = recoverForgemarkFile(file);
    expect(recovery.file.comments).toEqual([]);
    expect(recovery.problems[0]).toMatch(/line 15 \(comment id 6\)/);
  });

  it("names the record for a duplicate key", () => {
    const dup =
      "Prose.\n\n<!-- forgemark-comments\n" +
      "- id: 3\n  floating: true\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: x\n" +
      "  replies:\n    - author: B\n      timestamp: 2026-05-07T14:32:00Z\n      body: y\n" +
      "  replies:\n    - author: B\n      timestamp: 2026-05-07T14:32:00Z\n      body: z\n" +
      "-->\n";
    expect(() => parseForgemarkFile(dup)).toThrow(/comment id 3.*unique/);
  });
});

describe("a stray comments block in the body", () => {
  const stale = "# Doc\n\nProse.\n\n<!-- forgemark-comments\n- id: 1\n  body: [broken\n-->\n";

  it("is found by line, but not inside a code fence", () => {
    expect(findStrayBlock(stale)).toEqual({ line: 5 });
    const fenced = "Example:\n\n```\n<!-- forgemark-comments\n- id: 1\n-->\n```\n";
    expect(findStrayBlock(fenced)).toBeNull();
  });

  it("makes the serializer refuse to append a second block", () => {
    // The file opened with an unreadable block, which the fail-soft path
    // leaves in the body. Adding a comment and saving would have written
    // a second block with colliding ids.
    const recovery = recoverForgemarkFile(stale);
    expect(recovery.file.comments).toEqual([]);
    const withNew = {
      body: recovery.file.body,
      comments: [comment({ floating: true, anchor_text: undefined })],
    };
    expect(() => serializeForgemarkFile(withNew)).toThrow(ForgemarkSerializeError);
    expect(() => serializeForgemarkFile(withNew)).toThrow(/line 5/);
  });

  it("does not block a save with no comments (prose edits still work)", () => {
    expect(serializeForgemarkFile({ body: stale, comments: [] })).toBe(stale);
  });

  it("is reported by the fail-soft loader when a later block reads fine", () => {
    const two =
      stale +
      "\n<!-- forgemark-comments\n- id: 1\n  floating: true\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: ok\n-->\n";
    const recovery = recoverForgemarkFile(two);
    expect(recovery.file.comments).toHaveLength(1);
    expect(recovery.problems.join(" ")).toMatch(/earlier comments block at line 5/);
  });

  it("can be skipped for display-only serialization", () => {
    const withNew = { body: stale, comments: [comment({ floating: true })] };
    expect(() => serializeForgemarkFile(withNew, { validate: false })).not.toThrow();
  });
});

describe("normalizeAnchorText", () => {
  it("strips Markdown inline markup and collapses whitespace", () => {
    expect(normalizeAnchorText("retained at **twice** the\n  `rate`")).toBe(
      "retained at twice the rate",
    );
    expect(normalizeAnchorText("see the [docs](https://x.y) *now*")).toBe("see the docs now");
    expect(normalizeAnchorText("snake_case and 2*3")).toBe("snake_case and 2*3");
    expect(normalizeAnchorText("a `*literal*` star")).toBe("a *literal* star");
  });

  it("returns the code of a whole-block anchor", () => {
    expect(normalizeAnchorText('```python\nprint("hi")\n```')).toBe('print("hi")');
  });

  it("strips tags and decodes entities in HTML", () => {
    expect(normalizeAnchorText("ISF</code> &amp; <b>this</b>\n record", "html")).toBe(
      "ISF & this record",
    );
  });

  it("compares a recorded anchor_text against the source between markers", () => {
    expect(anchorTextMatches("twice the rate", "twice the **rate**")).toBe(true);
    expect(anchorTextMatches("twice the rate", "thrice the rate")).toBe(false);
  });
});
