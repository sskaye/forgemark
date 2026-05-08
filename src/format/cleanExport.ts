// Clean Export (Phase 11). Produces a plain markdown copy of the
// document with no Forgemark metadata: every `<!-- fmc:N -->` and
// `<!-- /fmc:N -->` marker pair is stripped from the body and the
// trailing `<!-- forgemark-comments -->` block is omitted.
//
// The anchored text itself is preserved verbatim — only the markers
// disappear. Floating notes (which carry no markers) leave the body
// unchanged. The result is what a reader without a Forgemark client
// should see.

import { removeMarkersFromBody } from "./compose";
import type { Comment } from "./types";

export function cleanExport(body: string, comments: Comment[]): string {
  let out = body;
  for (const c of comments) {
    if (c.floating) continue;
    out = removeMarkersFromBody(out, c.id);
  }
  return out;
}
