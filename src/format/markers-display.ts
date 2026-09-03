// Display-side helpers: convert the inline marker comments
// (`<!-- fmc:N --> ... <!-- /fmc:N -->`) in a markdown body into HTML
// `<span data-anchor-id="N">…</span>` wrappers that the editor / renderer
// can style.
//
// The markers in source must remain HTML comments — that is what the
// format spec promises and what the round-trip serializer expects. This
// helper is a *display-time* transformation and does NOT modify state.
//
// Only markers the scanner recognises are touched. A marker-shaped string
// inside a code fence or inline code is code — a spec quoting the format,
// say — and rewriting it used to eat the example (or leave a stray
// `</span>` in the fence) and could pair a real marker with a quoted one.

import { MARKER_OPEN_RE_G, MARKER_CLOSE_RE_G } from "./types";
import { findMarkersMarkdown, type Marker } from "./markers";

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
  const withBlocks = blockAnchorsToInfoString(body);
  const markers = findMarkersMarkdown(withBlocks);
  return spliceMarkers(withBlocks, markers, (m) =>
    m.type === "open" ? `<span data-anchor-id="${m.id}">` : "</span>",
  );
}

// A marker pair on its own lines around a fence, with nothing between
// the markers but the fence itself.
const FENCE_BLOCK_RE = /^\n(```[^\n]*\n[\s\S]*?\n```)\n$/;

// Move a block anchor's id from surrounding comment markers into the fence
// info string (`lang fmc=N`). Inverse of CodeBlockAnchor's serialize.
export function blockAnchorsToInfoString(body: string): string {
  const markers = findMarkersMarkdown(body);
  const edits: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i + 1 < markers.length; i++) {
    const open = markers[i];
    const close = markers[i + 1];
    if (open.type !== "open" || close.type !== "close" || open.id !== close.id) continue;
    const between = body.slice(open.end, close.start);
    const m = FENCE_BLOCK_RE.exec(between);
    if (!m) continue;
    const fence = m[1].replace(/^```([^\n]*)\n/, (_full, info: string) => {
      const trimmed = info.trim();
      return "```" + (trimmed ? trimmed + " " : "") + "fmc=" + open.id + "\n";
    });
    edits.push({ start: open.start, end: close.end, text: fence });
    i++;
  }
  return applyEdits(body, edits);
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
// We merge `<!-- /fmc:N -->GAP<!-- fmc:N -->` into just `GAP` whenever the
// two are consecutive real markers — so the gap holds no other comment's
// markers — leaving exactly one pair from the first open to the last
// close. The markers are invisible HTML comments, so spanning the
// intervening `*`/`[]()` syntax does not change rendering.
export function coalesceAnchorMarkers(body: string): string {
  let prev: string;
  let next = body;
  // Loop to a fixed point: one pass collapses every junction in a run,
  // but looping is a cheap safety net against pathological input.
  do {
    prev = next;
    const markers = findMarkersMarkdown(prev);
    const edits: { start: number; end: number; text: string }[] = [];
    for (let i = 0; i + 1 < markers.length; i++) {
      const a = markers[i];
      const b = markers[i + 1];
      if (a.type === "close" && b.type === "open" && a.id === b.id) {
        edits.push({ start: a.start, end: b.end, text: prev.slice(a.end, b.start) });
        i++;
      }
    }
    next = applyEdits(prev, edits);
  } while (next !== prev);
  return next;
}

function spliceMarkers(body: string, markers: Marker[], render: (m: Marker) => string): string {
  return applyEdits(
    body,
    markers.map((m) => ({ start: m.start, end: m.end, text: render(m) })),
  );
}

// Apply non-overlapping replacements given in document order.
function applyEdits(body: string, edits: { start: number; end: number; text: string }[]): string {
  if (edits.length === 0) return body;
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += body.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + body.slice(cursor);
}

// Kept for callers that still want the raw patterns.
export { MARKER_OPEN_RE_G, MARKER_CLOSE_RE_G };
