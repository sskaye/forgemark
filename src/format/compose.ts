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

// Replace the text inside a comment's marker pair with `replacement`
// and strip the marker pair from the body. Returns the new body plus the
// previously-anchored text (so callers can compare against
// suggested_edit.from for the lost-anchor branch).
//
// Returns null when no marker pair for the id exists (e.g. floating
// note, or already removed).
import { findMarkers, pairMarkers } from "./markers";

export function replaceAnchoredText(
  body: string,
  id: number,
  replacement: string,
): { body: string; previousText: string } | null {
  const markers = findMarkers(body);
  const { pairs } = pairMarkers(markers);
  const pair = pairs.find((p) => p.id === id);
  if (!pair) return null;
  const previousText = body.slice(pair.open.end, pair.close.start);
  const before = body.slice(0, pair.open.start);
  const after = body.slice(pair.close.end);
  return { body: before + replacement + after, previousText };
}

// Strip the marker pair for `id` from the body without touching the
// anchored text. Used by reject-suggestion (the prose stays exactly as
// it was; only the markers and YAML record are removed).
export function stripAnchoredMarkers(body: string, id: number): string | null {
  const markers = findMarkers(body);
  const { pairs } = pairMarkers(markers);
  const pair = pairs.find((p) => p.id === id);
  if (!pair) return null;
  const before = body.slice(0, pair.open.start);
  const inside = body.slice(pair.open.end, pair.close.start);
  const after = body.slice(pair.close.end);
  return before + inside + after;
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
