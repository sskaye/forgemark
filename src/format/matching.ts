// Candidate ranking for orphaned anchors.
//
// Extracted from `reattach.ts` so both the Markdown path (which ranks
// over the raw body) and the HTML path (which ranks over rendered text
// and maps the winners back to source offsets) share one implementation.
// The functions here are pure string work: they know nothing about
// documents, formats, or offsets beyond the haystack they are handed.

import type { Comment } from "./types";

export type ReattachCandidate = {
  // Byte offsets in the haystack that the candidate covers.
  from: number;
  to: number;
  // The matched substring. Useful for preview.
  text: string;
  // Why this candidate matched: exact substring, exact + context boost,
  // or fuzzy token-window match. Surfaces in the UI as a hint.
  rationale: "exact" | "exact-with-context" | "fuzzy";
  // Higher is better, in [0, 1].
  score: number;
};

// Rank `anchor` against `body`: exact matches when there are any, fuzzy
// windows otherwise. This is the whole ranking policy in one place.
export function rankCandidates(
  body: string,
  anchor: string,
  comment: Comment,
  max: number,
): ReattachCandidate[] {
  if (!anchor || anchor.length === 0) return [];
  const exact = exactCandidates(body, anchor, comment);
  if (exact.length > 0) return exact.slice(0, max);
  return fuzzyCandidates(body, anchor).slice(0, max);
}

export function exactCandidates(
  body: string,
  anchor: string,
  comment: Comment,
): ReattachCandidate[] {
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

export function fuzzyCandidates(body: string, anchor: string): ReattachCandidate[] {
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
