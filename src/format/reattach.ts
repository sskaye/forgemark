// Reattachment / lost-anchor detection (Phase 9).
//
// When a file is loaded — or after an external edit — every comment
// without `floating: true` should resolve to a marker pair around the
// passage it was attached to. The parser refuses files where YAML
// records and marker pairs disagree (1:1 invariant), so a "lost anchor"
// arises only when an external editor (human or AI) drops the markers
// while leaving the anchor text mostly intact, OR rewrites the anchor
// text such that no markers exist anymore.
//
// This module is purely textual:
//
//   getAnchorStatus(body, comment)
//     → "attached"  — markers exist, paired
//     → "floating"  — comment.floating === true
//     → "orphaned"  — no markers; UI surfaces a Reattach modal
//
//   findCandidates(body, comment)
//     → ranked list of substrings of `body` that look like good
//       reattachment targets, top-N. Used by the modal.
//
// The strategy follows the proposal:
//
//   1. Marker pair present in body → attached.
//   2. Else exact `anchor_text` match → candidate(s) at score 1.0;
//      boosted by surrounding `context_before` / `context_after` match.
//   3. Else fuzzy token-window match → candidate(s) at 0.5 + sim*0.4.
//   4. Else no candidates → user picks Keep as floating note / Discard.
//
// Performance:
//
//   The fuzzy step is the only one with super-linear potential. Naive
//   sliding-window Levenshtein on a 50k-word body × 50 anchors blows
//   past the 2-second budget the plan calls for. We narrow with a
//   "longest distinctive token" prefilter — pick the longest token in
//   the anchor (most distinctive), find its body positions, and only
//   probe windows centred on those positions. That drops the candidate
//   count by orders of magnitude on real prose.

import type { Comment, DocFormat } from "./types";
import { DEFAULT_FORMAT } from "./types";
import { findMarkers, pairMarkers } from "./markers";
import { rankCandidates, type ReattachCandidate } from "./matching";
import { htmlCandidates } from "./html/candidates";

export type { ReattachCandidate } from "./matching";
export { levenshtein } from "./matching";

export type AnchorStatus =
  | { kind: "attached"; from: number; to: number }
  | { kind: "orphaned"; candidates: ReattachCandidate[] }
  | { kind: "floating" };

const MAX_CANDIDATES = 5;

// Detect anchor status for one comment relative to the current body.
export function getAnchorStatus(
  body: string,
  comment: Comment,
  format: DocFormat = DEFAULT_FORMAT,
): AnchorStatus {
  if (comment.floating) return { kind: "floating" };
  const markers = findMarkers(body, format);
  const { pairs } = pairMarkers(markers);
  const pair = pairs.find((p) => p.id === comment.id);
  if (pair) {
    return { kind: "attached", from: pair.open.start, to: pair.close.end };
  }
  return { kind: "orphaned", candidates: findCandidates(body, comment, format) };
}

// Convenience: classify every comment at once. The body is parsed once
// for marker pairs (the expensive bit); fuzzy candidate generation only
// runs for orphans.
export function classifyAnchors(
  body: string,
  comments: Comment[],
  format: DocFormat = DEFAULT_FORMAT,
): Map<number, AnchorStatus> {
  const out = new Map<number, AnchorStatus>();
  const markers = findMarkers(body, format);
  const { pairs } = pairMarkers(markers);
  const pairById = new Map<number, (typeof pairs)[number]>();
  for (const p of pairs) pairById.set(p.id, p);
  for (const c of comments) {
    if (c.floating) {
      out.set(c.id, { kind: "floating" });
      continue;
    }
    const pair = pairById.get(c.id);
    if (pair) {
      out.set(c.id, { kind: "attached", from: pair.open.start, to: pair.close.end });
      continue;
    }
    out.set(c.id, { kind: "orphaned", candidates: findCandidates(body, c, format) });
  }
  return out;
}

// ── candidate finding ─────────────────────────────────────────────────

export function findCandidates(
  body: string,
  comment: Comment,
  format: DocFormat = DEFAULT_FORMAT,
): ReattachCandidate[] {
  const anchor = comment.anchor_text;
  if (!anchor || anchor.length === 0) return [];

  // HTML bodies are mostly markup, so matching `anchor_text` against the
  // raw source finds little — the prose the reviewer selected is broken
  // up by tags and entity references. `htmlCandidates` runs the same
  // ranking over the *rendered* text and maps the winning ranges back to
  // source offsets. See `html/candidates.ts`.
  if (format === "html") return htmlCandidates(body, comment, MAX_CANDIDATES);

  return rankCandidates(body, anchor, comment, MAX_CANDIDATES);
}
