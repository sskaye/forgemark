// Display-side helpers: convert the inline marker comments
// (`<!-- fmc:N --> ... <!-- /fmc:N -->`) in a markdown body into HTML
// `<span data-anchor-id="N">…</span>` wrappers that the editor / renderer
// can style.
//
// The markers in source must remain HTML comments — that is what the
// format spec promises and what the round-trip serializer expects. This
// helper is a *display-time* transformation and does NOT modify state.

import { MARKER_OPEN_RE_G, MARKER_CLOSE_RE_G } from "./types";

// Replaces every paired marker with a span element that carries the
// anchor id. Other inline HTML in the body is left alone.
//
// Whole-code-block anchors are handled first: a marker pair wrapping a
// fenced block (markers on their own lines, outside the fence) is rewritten
// so the id rides in the fence info string (`lang fmc=N`), which the
// CodeBlockAnchor extension reads on parse. Doing this before the inline
// span replacement also stops those block markers from being turned into
// (invalid) inline spans around a block.
export function bodyWithAnchorSpans(body: string): string {
  return blockAnchorsToInfoString(body)
    .replace(MARKER_OPEN_RE_G, (_full, id: string) => `<span data-anchor-id="${id}">`)
    .replace(MARKER_CLOSE_RE_G, () => `</span>`);
}

// Matches `<!-- fmc:N -->\n```lang\n…\n```\n<!-- /fmc:N -->` — a comment
// marker pair wrapping a fenced code block on its own lines.
const BLOCK_ANCHOR_RE =
  /<!--\s*fmc:(\d+)\s*-->\n(```[^\n]*\n[\s\S]*?\n```)\n<!--\s*\/fmc:\1\s*-->/g;

// Move a block anchor's id from surrounding comment markers into the fence
// info string (`lang fmc=N`). Inverse of CodeBlockAnchor's serialize.
export function blockAnchorsToInfoString(body: string): string {
  return body.replace(BLOCK_ANCHOR_RE, (_full, id: string, fence: string) =>
    fence.replace(/^```([^\n]*)\n/, (_m, info: string) => {
      const trimmed = info.trim();
      return "```" + (trimmed ? trimmed + " " : "") + "fmc=" + id + "\n";
    }),
  );
}

// Reverse direction: convert anchor `<span data-anchor-id="N">…</span>`
// wrappers in markdown text back to the canonical marker comments.
//
// We track a stack so each closing `</span>` becomes the close marker for
// the most recently opened anchor. Other `<span>`s in the user's prose
// (without `data-anchor-id`) are left alone.
const ANCHOR_OPEN_OR_CLOSE = /<span data-anchor-id="(\d+)"[^>]*>|<\/span>/g;

export function bodyFromAnchorSpans(text: string): string {
  const stack: string[] = [];
  const withMarkers = text.replace(ANCHOR_OPEN_OR_CLOSE, (match, id?: string) => {
    if (id) {
      stack.push(id);
      return `<!-- fmc:${id} -->`;
    }
    const popped = stack.pop();
    if (!popped) return match; // unrelated </span>; leave it
    return `<!-- /fmc:${popped} -->`;
  });
  return coalesceAnchorMarkers(withMarkers);
}

// Collapse a run of same-id marker pairs that Tiptap emits when a single
// anchored selection spans inline-formatting tokens (`*em*`, `[link]()`,
// inline code). Each differently-marked text run round-trips as its own
// `<span data-anchor-id="N">`, so one comment can yield many pairs sharing
// id N — which the parser rejects as a "Duplicate marker pair", blanking
// every comment in the file.
//
// We merge `<!-- /fmc:N -->GAP<!-- fmc:N -->` into just `GAP` whenever GAP
// contains no other marker, leaving exactly one pair from the first open
// to the last close. The markers are invisible HTML comments, so spanning
// the intervening `*`/`[]()` syntax does not change rendering. The
// negative lookahead guarantees we never merge across a *different*
// comment's markers (the overlap case, which is prevented at creation).
const SAME_ID_JUNCTION =
  /<!--\s*\/fmc:(\d+)\s*-->((?:(?!<!--\s*\/?fmc:)[\s\S])*?)<!--\s*fmc:\1\s*-->/g;

export function coalesceAnchorMarkers(body: string): string {
  let prev: string;
  let next = body;
  // Loop to a fixed point: a single global pass collapses all junctions
  // in a run, but looping is a cheap safety net against pathological input.
  do {
    prev = next;
    next = prev.replace(SAME_ID_JUNCTION, (_full, _id: string, gap: string) => gap);
  } while (next !== prev);
  return next;
}
