import { describe, it } from "vitest";
import fc from "fast-check";
import { parseForgemarkFile, serializeForgemarkFile } from "../../../src/format";
import type { Comment, Reply, SuggestedEdit } from "../../../src/format/types";
import { openMarker, closeMarker } from "../../../src/format/types";

// Property-based round-trip: generate a random valid Comment[], wrap with
// a synthetic body that has the matching markers, serialize, parse,
// assert deep equality on the structured form.
//
// This catches edge cases the hand-written tests don't think of:
// unusual character combinations in bodies, suggestion-only comments,
// floating notes, multiple comments interleaved with prose.

// ── Generators ─────────────────────────────────────────────────────────

const arbAuthor = fc.constantFrom("Claude", "ChatGPT", "Maya", "Devon", "Steven");

// ISO-8601 UTC timestamp generator (just enough variety to cover the
// expected shape).
const arbTimestamp = fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }).map((ms) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" +
    pad(d.getUTCMonth() + 1) +
    "-" +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    ":" +
    pad(d.getUTCMinutes()) +
    ":" +
    pad(d.getUTCSeconds()) +
    "Z"
  );
});

// User-content text. Excludes characters that the YAML emitter doesn't
// handle (pure JSON-safe ASCII + spaces + a few punctuations). This is
// intentionally narrow — we cover special sequences (`-->`, `<!--`) in
// dedicated unit tests; here we want broad fuzz over normal text.
const arbContentChar = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?'-".split(""),
);
const arbShortText = fc
  .array(arbContentChar, { minLength: 1, maxLength: 40 })
  .map((cs) => cs.join("").trim())
  .filter((s) => s.length >= 1);

// A possibly-multi-line body. Must end with newline (matches the literal
// block-style YAML emit). Trims any trailing spaces per line.
const arbBody = fc
  .array(arbShortText, { minLength: 1, maxLength: 4 })
  .map(
    (lines) =>
      lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n") + "\n",
  )
  .filter((s) => s.trim().length >= 1);

const arbReply: fc.Arbitrary<Reply> = fc.record({
  author: arbAuthor,
  timestamp: arbTimestamp,
  body: arbBody,
});

const arbSuggestion: fc.Arbitrary<SuggestedEdit> = fc.record({
  from: arbShortText,
  to: arbShortText,
});

// Plain (non-floating) comment with markers in body. body is required.
const arbPlainComment: fc.Arbitrary<Omit<Comment, "id">> = fc.record(
  {
    anchor_text: arbShortText,
    author: arbAuthor,
    timestamp: arbTimestamp,
    resolved: fc.boolean(),
    body: arbBody,
    replies: fc.option(fc.array(arbReply, { minLength: 0, maxLength: 3 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ["anchor_text", "author", "timestamp", "resolved", "body"] },
);

// Suggestion comment: body optional, suggested_edit present.
const arbSuggestionComment: fc.Arbitrary<Omit<Comment, "id">> = fc.record(
  {
    anchor_text: arbShortText,
    author: arbAuthor,
    timestamp: arbTimestamp,
    resolved: fc.constant(false),
    body: fc.option(arbBody, { nil: undefined }),
    suggested_edit: arbSuggestion,
  },
  {
    requiredKeys: ["anchor_text", "author", "timestamp", "resolved", "suggested_edit"],
  },
);

// Floating note: no anchor_text, no markers in body.
const arbFloating: fc.Arbitrary<Omit<Comment, "id">> = fc.record(
  {
    floating: fc.constant(true),
    author: arbAuthor,
    timestamp: arbTimestamp,
    resolved: fc.boolean(),
    body: arbBody,
  },
  { requiredKeys: ["floating", "author", "timestamp", "resolved", "body"] },
);

const arbCommentShape = fc.oneof(arbPlainComment, arbSuggestionComment, arbFloating);

// Build a complete `{ body, comments }` from a list of comment shapes
// by assigning sequential ids and constructing a synthetic body that
// has marker pairs for each non-floating comment.
function buildFile(shapes: Omit<Comment, "id">[]): { body: string; comments: Comment[] } {
  const comments: Comment[] = shapes.map((s, i) => ({ ...s, id: i + 1 }));
  const sentences: string[] = ["Synthetic body."];
  for (const c of comments) {
    if (c.floating) continue;
    sentences.push(
      `Sentence ${c.id} with ${openMarker(c.id)}${c.anchor_text}${closeMarker(c.id)} mid-line.`,
    );
  }
  const body = sentences.join("\n\n") + "\n";
  return { body, comments };
}

describe("property-based round-trip", () => {
  it("parse(serialize(file)) === file in shape", () => {
    fc.assert(
      fc.property(fc.array(arbCommentShape, { minLength: 1, maxLength: 5 }), (shapes) => {
        const original = buildFile(shapes);
        const text = serializeForgemarkFile(original);
        const reparsed = parseForgemarkFile(text);
        // Comment arrays match deeply.
        if (reparsed.comments.length !== original.comments.length) return false;
        for (let i = 0; i < original.comments.length; i++) {
          const a = original.comments[i];
          const b = reparsed.comments[i];
          if (a.id !== b.id) return false;
          if (a.author !== b.author) return false;
          if (a.timestamp !== b.timestamp) return false;
          if (a.resolved !== b.resolved) return false;
          if (a.body !== b.body) return false;
          if (a.anchor_text !== b.anchor_text) return false;
          if ((a.floating ?? false) !== (b.floating ?? false)) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  it("serialize(parse(serialize(file))) === serialize(file) (idempotence)", () => {
    fc.assert(
      fc.property(fc.array(arbCommentShape, { minLength: 1, maxLength: 5 }), (shapes) => {
        const file = buildFile(shapes);
        const once = serializeForgemarkFile(file);
        const twice = serializeForgemarkFile(parseForgemarkFile(once));
        return once === twice;
      }),
      { numRuns: 500 },
    );
  });
});
