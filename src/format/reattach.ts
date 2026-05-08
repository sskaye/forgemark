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

import type { Comment } from "./types";
import { findMarkers, pairMarkers } from "./markers";

export type AnchorStatus =
  | { kind: "attached"; from: number; to: number }
  | { kind: "orphaned"; candidates: ReattachCandidate[] }
  | { kind: "floating" };

export type ReattachCandidate = {
  // Byte offsets in `body` that the candidate covers.
  from: number;
  to: number;
  // The matched substring of `body`. Useful for preview.
  text: string;
  // Why this candidate matched: exact substring, exact + context boost,
  // or fuzzy token-window match. Surfaces in the UI as a hint.
  rationale: "exact" | "exact-with-context" | "fuzzy";
  // Higher is better, in [0, 1].
  score: number;
};

const MAX_CANDIDATES = 5;

// Detect anchor status for one comment relative to the current body.
export function getAnchorStatus(body: string, comment: Comment): AnchorStatus {
  if (comment.floating) return { kind: "floating" };
  const markers = findMarkers(body);
  const { pairs } = pairMarkers(markers);
  const pair = pairs.find((p) => p.id === comment.id);
  if (pair) {
    return { kind: "attached", from: pair.open.start, to: pair.close.end };
  }
  return { kind: "orphaned", candidates: findCandidates(body, comment) };
}

// Convenience: classify every comment at once. The body is parsed once
// for marker pairs (the expensive bit); fuzzy candidate generation only
// runs for orphans.
export function classifyAnchors(body: string, comments: Comment[]): Map<number, AnchorStatus> {
  const out = new Map<number, AnchorStatus>();
  const markers = findMarkers(body);
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
    out.set(c.id, { kind: "orphaned", candidates: findCandidates(body, c) });
  }
  return out;
}

// ── candidate finding ─────────────────────────────────────────────────

export function findCandidates(body: string, comment: Comment): ReattachCandidate[] {
  const anchor = comment.anchor_text;
  if (!anchor || anchor.length === 0) return [];

  const exact = exactCandidates(body, anchor, comment);
  if (exact.length > 0) {
    return exact.slice(0, MAX_CANDIDATES);
  }
  return fuzzyCandidates(body, anchor).slice(0, MAX_CANDIDATES);
}

function exactCandidates(body: string, anchor: string, comment: Comment): ReattachCandidate[] {
  const out: ReattachCandidate[] = [];
  let i = 0;
  while (true) {
    const at = body.indexOf(anchor, i);
    if (at === -1) break;
    const from = at;
    const to = at + anchor.length;
    const score = scoreWithContext(body, from, to, comment);
    out.push({
      from,
      to,
      text: anchor,
      rationale: score > 1.0 ? "exact-with-context" : "exact",
      score: Math.min(1, score),
    });
    i = at + 1;
  }
  out.sort((a, b) => b.score - a.score || a.from - b.from);
  return out;
}

// Boost by ±0.04 each when context_before / context_after fit. We cap
// the returned score at 1.0 so "exact + both contexts" still ranks
// above "exact alone" without needing a wider numeric range.
function scoreWithContext(body: string, from: number, to: number, comment: Comment): number {
  let score = 0.95; // base for exact substring (sub-1 so context can lift)
  const before = comment.context_before?.trim();
  const after = comment.context_after?.trim();
  if (before && before.length > 0) {
    const window = body.slice(Math.max(0, from - before.length - 8), from);
    if (window.includes(before) || endsWithFlexible(window, before)) score += 0.04;
  }
  if (after && after.length > 0) {
    const window = body.slice(to, Math.min(body.length, to + after.length + 8));
    if (window.includes(after) || startsWithFlexible(window, after)) score += 0.04;
  }
  return score;
}

function endsWithFlexible(s: string, suffix: string): boolean {
  // Allow trailing whitespace on either side.
  return s.replace(/\s+$/, "").endsWith(suffix.replace(/\s+$/, ""));
}

function startsWithFlexible(s: string, prefix: string): boolean {
  return s.replace(/^\s+/, "").startsWith(prefix.replace(/^\s+/, ""));
}

// ── fuzzy fallback ────────────────────────────────────────────────────
//
// Strategy:
//   1. Tokenize the anchor (whitespace).
//   2. Pick the most distinctive single token by length (longer ≈ rarer
//      in English prose). Ties broken by alphabetical order for
//      determinism.
//   3. Scan the body for occurrences of that token (case-folded). Each
//      occurrence is a candidate "anchor centre".
//   4. For each centre, slice a window of the same character length as
//      the anchor (±20%) and compute Levenshtein distance against the
//      anchor (case-folded).
//   5. Keep candidates whose normalised similarity ≥ 0.6 and rank by
//      similarity.

const FUZZY_THRESHOLD = 0.6;

function fuzzyCandidates(body: string, anchor: string): ReattachCandidate[] {
  if (anchor.length < 6) return []; // too short for fuzzy to be meaningful

  const anchorLower = anchor.toLowerCase();
  const distinctive = pickDistinctiveToken(anchor);
  if (!distinctive) return [];

  const positions = caseInsensitiveIndexAll(body, distinctive);
  if (positions.length === 0) return [];

  const out: ReattachCandidate[] = [];
  const seen = new Set<string>(); // dedupe by `from`
  const halfLen = anchor.length;
  for (const p of positions) {
    // Try a few window placements around the distinctive-token centre.
    // The anchor's distinctive token may sit anywhere within the anchor;
    // we don't know offset, so probe a few alignments.
    const offsets = [0, Math.floor(halfLen * 0.5), Math.floor(halfLen * 0.8)];
    for (const off of offsets) {
      const from = Math.max(0, Math.min(body.length - anchor.length, p - off));
      const to = Math.min(body.length, from + anchor.length);
      const key = `${from}:${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const window = body.slice(from, to);
      const dist = levenshtein(window.toLowerCase(), anchorLower);
      const maxLen = Math.max(window.length, anchor.length);
      const sim = maxLen === 0 ? 0 : 1 - dist / maxLen;
      if (sim >= FUZZY_THRESHOLD) {
        out.push({
          from,
          to,
          text: window,
          rationale: "fuzzy",
          score: 0.5 + sim * 0.4, // [0.5, 0.9] roughly
        });
      }
    }
  }
  out.sort((a, b) => b.score - a.score || a.from - b.from);
  return out;
}

function pickDistinctiveToken(anchor: string): string | null {
  const tokens = anchor.split(/\s+/).filter((t) => /[a-z0-9]/i.test(t));
  if (tokens.length === 0) return null;
  // Sort by length desc, then alphabetical for determinism. Strip a
  // light set of punctuation from the ends.
  const norm = tokens
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter((t) => t.length >= 4);
  if (norm.length === 0) {
    // Fall back to the longest raw token, anything is better than nothing.
    return tokens.slice().sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
  }
  norm.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return norm[0];
}

function caseInsensitiveIndexAll(body: string, needle: string): number[] {
  const lower = body.toLowerCase();
  const target = needle.toLowerCase();
  const out: number[] = [];
  let i = 0;
  while (true) {
    const at = lower.indexOf(target, i);
    if (at === -1) break;
    out.push(at);
    i = at + 1;
  }
  return out;
}

// Levenshtein distance, single-row DP. Operating on UTF-16 code units is
// fine for our prose (no astral chars in markdown anchors of any
// realistic shape).
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
