// Comments on a Markdown file's front matter.
//
// The front matter is YAML that other programs read — an agent skill's
// `name` and `description`, a site generator's title — so a comment
// can't put markers in it: inside a value they change the value, between
// the `---` fences they aren't YAML, and before the opening fence they
// stop it being front matter at all. A comment on it is kept without
// markers instead: a floating note (so any version reads it) that also
// says `anchor_frontmatter: true`, quoting the passage in `anchor_text`
// with the text either side. This version shows it on that passage in
// the front matter; an older one shows a floating note quoting it.
//
// The reader sees the front matter as its raw YAML, so passages are
// matched against that text, whitespace runs alike.

import type { Comment } from "./types";
import { splitFrontmatter } from "./frontmatter";
import { contextSnippet } from "./compose";
import { AnchorError } from "./locate";

export type FrontmatterPlacement = {
  // Offsets into the body (the front matter is at its start).
  start: number;
  end: number;
  anchor_text: string;
  context_before: string;
  context_after: string;
};

// The front matter's YAML, between the fences, and where it starts.
export function frontmatterText(body: string): { text: string; offset: number } | null {
  const { front } = splitFrontmatter(body);
  if (!front) return null;
  const open = front.indexOf("\n") + 1;
  const close = front.lastIndexOf("\n---");
  return { text: front.slice(open, Math.max(open, close + 1)), offset: open };
}

// The length of the front matter block at the start of the body, fences
// and following blank lines included; 0 when there is none.
export function frontmatterLength(body: string): number {
  return splitFrontmatter(body).front.length;
}

function matchesIn(text: string, phrase: string): { start: number; end: number }[] {
  const needle = phrase.replace(/\s+/g, " ").trim();
  if (!needle) return [];
  const escaped = needle
    .split(" ")
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(new RegExp(escaped, "g"))) {
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

// Find a quoted passage in the front matter.
export function locateInFrontmatter(
  body: string,
  phrase: string,
  opts: { occurrence?: number } = {},
): FrontmatterPlacement {
  const fm = frontmatterText(body);
  const needle = phrase.replace(/\s+/g, " ").trim();
  if (!fm) throw new AnchorError("This file has no front matter.", "not-found");
  const matches = matchesIn(fm.text, needle);
  if (matches.length === 0) {
    throw new AnchorError(`"${needle}" was not found in the front matter.`, "not-found");
  }
  let m = matches[0];
  if (opts.occurrence !== undefined) {
    const picked = matches[opts.occurrence - 1];
    if (!picked) {
      throw new AnchorError(
        `--occurrence ${opts.occurrence} is out of range: "${needle}" appears ${matches.length} time(s) in the front matter.`,
        "invalid",
      );
    }
    m = picked;
  } else if (matches.length > 1) {
    throw new AnchorError(
      `"${needle}" appears ${matches.length} times in the front matter. Add --occurrence N to pick one, or quote a longer passage.`,
      "ambiguous",
      { count: matches.length },
    );
  }
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return {
    start: fm.offset + m.start,
    end: fm.offset + m.end,
    anchor_text: flat(fm.text.slice(m.start, m.end)).trim(),
    context_before: contextSnippet(flat(fm.text.slice(0, m.start)), "before"),
    context_after: contextSnippet(flat(fm.text.slice(m.end)), "after"),
  };
}

// The record for a comment on the front matter.
export function frontmatterFields(p: FrontmatterPlacement): Partial<Comment> {
  return {
    floating: true,
    anchor_frontmatter: true,
    anchor_text: p.anchor_text,
    ...(p.context_before ? { context_before: p.context_before } : {}),
    ...(p.context_after ? { context_after: p.context_after } : {}),
  };
}

// Where a front-matter comment's passage is now, or null if it is gone.
// Several copies: the one whose recorded surroundings match best.
export function findFrontmatterPassage(
  body: string,
  comment: Comment,
): { start: number; end: number } | null {
  const fm = frontmatterText(body);
  if (!fm || !comment.anchor_text) return null;
  const matches = matchesIn(fm.text, comment.anchor_text);
  if (matches.length === 0) return null;
  const before = (comment.context_before ?? "").replace(/\s+/g, " ").trim();
  const after = (comment.context_after ?? "").replace(/\s+/g, " ").trim();
  const score = (m: { start: number; end: number }) => {
    const b = fm.text.slice(0, m.start).replace(/\s+/g, " ").trimEnd();
    const a = fm.text.slice(m.end).replace(/\s+/g, " ").trimStart();
    return (before && b.endsWith(before) ? 1 : 0) + (after && a.startsWith(after) ? 1 : 0);
  };
  const best = [...matches].sort((x, y) => score(y) - score(x))[0];
  return { start: fm.offset + best.start, end: fm.offset + best.end };
}

export function isFrontmatterComment(c: Comment): boolean {
  return c.floating === true && c.anchor_frontmatter === true;
}
