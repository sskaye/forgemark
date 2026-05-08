// Compose helpers for inserting a new comment into a document body and
// computing the new comment's metadata. Used by the new-comment composer
// (Phase 5) and reused by future state-change actions (Phase 6+).

import type { Comment } from "./types";
import { openMarker, closeMarker } from "./types";

// Pick the next sequential integer id. Always one greater than the max
// existing id, so gaps in the comment list are tolerated (delete leaves
// holes; new comments don't fill them).
export function nextCommentId(existing: Comment[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((c) => c.id)) + 1;
}

// Insert paired marker comments into the body string at the given byte
// offsets. The offsets are computed before insertion; close goes in
// first so the open offset stays valid.
export function insertMarkersIntoBody(
  body: string,
  start: number,
  end: number,
  id: number,
): string {
  if (start < 0 || end < start || end > body.length) {
    throw new Error(
      `insertMarkersIntoBody: invalid range [${start}, ${end}] for body of length ${body.length}`,
    );
  }
  const open = openMarker(id);
  const close = closeMarker(id);
  // Splice close first so open's offset stays unchanged.
  const withClose = body.slice(0, end) + close + body.slice(end);
  const withBoth = withClose.slice(0, start) + open + withClose.slice(start);
  return withBoth;
}

// Remove the marker pair for the given id from a body, leaving the
// anchored text in place. Used by the delete-comment flow (Phase 6).
// Multiple pairs for the same id (which the parser would reject anyway)
// are all stripped, defensively.
export function removeMarkersFromBody(body: string, id: number): string {
  const open = new RegExp(`<!--\\s*fmc:${id}\\s*-->`, "g");
  const close = new RegExp(`<!--\\s*/fmc:${id}\\s*-->`, "g");
  return body.replace(open, "").replace(close, "");
}

// Pull a snippet of context from a plain-text source, trimmed to a
// sentence-like boundary so the orphan-recovery pass (Phase 9) has
// something useful to match.
export function contextSnippet(text: string, side: "before" | "after", maxChars = 80): string {
  if (text.length === 0) return "";
  if (side === "before") {
    const slice = text.slice(-maxChars);
    // Trim to start at a sentence boundary if one is in range.
    const m = slice.match(/[.!?]\s+(.+)$/);
    return (m ? m[1] : slice).trim();
  } else {
    const slice = text.slice(0, maxChars);
    const m = slice.match(/^(.+?)[.!?](\s|$)/);
    return (m ? m[1] + "." : slice).trim();
  }
}
