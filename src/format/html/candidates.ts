// Reattachment candidates for HTML bodies.
//
// The Markdown path ranks `anchor_text` against the raw body, which
// works because a Markdown body *is* mostly the prose. An HTML body is
// mostly markup: the sentence a reviewer highlighted is split across
// tags and peppered with entity references, so a raw-source search finds
// nothing and the reviewer is told their comment can't be recovered —
// precisely when it matters most, because generated reports are replaced
// wholesale rather than edited.
//
// Three strategies, strongest first:
//
//   1. `anchor_selector` — the id the element had when the comment was
//      made. If the regenerated report kept it, this is exact.
//   2. `anchor_kind: element` — find the block whose rendered text
//      matches the caption, and wrap the block, not the caption.
//   3. Text — rank over the rendered text and map back to source bytes,
//      sharing the ranking policy with Markdown (`matching.ts`).

import type { Comment } from "../types";
import { rankCandidates, type ReattachCandidate } from "../matching";
import { findBySelector, findByText, type ElementSpan } from "./elements";
import { buildHtmlTextMap, textRangeToSource } from "./textmap";

export function htmlCandidates(body: string, comment: Comment, max: number): ReattachCandidate[] {
  const anchor = comment.anchor_text;
  if (!anchor || anchor.length === 0) return [];

  const out: ReattachCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: ReattachCandidate) => {
    const key = `${candidate.from}:${candidate.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  // 1. The recorded id, if the report still has it. An exact hit here is
  //    the difference between "review survived the rebuild" and "review
  //    survived the rebuild, probably".
  if (comment.anchor_selector) {
    const span = safely(() => findBySelector(body, comment.anchor_selector!));
    if (span) add(fromElement(span, "exact-with-context", 1));
  }

  // 2. An element anchor with no usable selector: match the block by its
  //    caption but anchor the block. Matching as text would put the
  //    markers around the caption line and leave the chart uncommented.
  if (comment.anchor_kind === "element" && out.length < max) {
    const span = safely(() => findByText(body, anchor, { preferBlock: true }));
    if (span) add(fromElement(span, "exact", 0.9));
  }

  if (out.length >= max) return out.slice(0, max);

  // 3. Text, in rendered coordinates.
  const map = buildHtmlTextMap(body);
  if (map.text.length > 0) {
    for (const candidate of rankCandidates(map.text, anchor, comment, max * 2)) {
      // A range that can't be mapped exactly is dropped rather than
      // approximated: a marker spliced at a guessed offset could land
      // inside an entity or a tag.
      const span = textRangeToSource(map, candidate.from, candidate.to, { requireExact: true });
      if (!span) continue;
      add({ ...candidate, from: span.start, to: span.end });
      if (out.length >= max) break;
    }
  }

  return out.slice(0, max);
}

function fromElement(
  span: ElementSpan,
  rationale: ReattachCandidate["rationale"],
  score: number,
): ReattachCandidate {
  return { from: span.start, to: span.end, text: span.text, rationale, score };
}

// A malformed selector or a pathological document must degrade to the
// text path, never take the reattach flow down with it.
function safely<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
