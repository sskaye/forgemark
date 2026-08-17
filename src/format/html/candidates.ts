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
// So rank over the rendered text and map the winners back to source
// offsets. Ranking policy is shared with Markdown (`matching.ts`); only
// the haystack and the coordinate system change.

import type { Comment } from "../types";
import { rankCandidates, type ReattachCandidate } from "../matching";
import { buildHtmlTextMap, textRangeToSource } from "./textmap";

export function htmlCandidates(body: string, comment: Comment, max: number): ReattachCandidate[] {
  const anchor = comment.anchor_text;
  if (!anchor || anchor.length === 0) return [];

  const map = buildHtmlTextMap(body);
  if (map.text.length === 0) return [];

  // Rank in rendered-text coordinates, then translate. A candidate whose
  // range can't be mapped exactly is dropped rather than approximated —
  // inserting a marker at a guessed offset could land inside an entity.
  const ranked = rankCandidates(map.text, anchor, comment, max * 2);
  const out: ReattachCandidate[] = [];
  for (const c of ranked) {
    const span = textRangeToSource(map, c.from, c.to, { requireExact: true });
    if (!span) continue;
    out.push({ ...c, from: span.start, to: span.end });
    if (out.length >= max) break;
  }
  return out;
}
