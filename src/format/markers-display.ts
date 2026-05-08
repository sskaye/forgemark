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
export function bodyWithAnchorSpans(body: string): string {
  return body
    .replace(MARKER_OPEN_RE_G, (_full, id: string) => `<span data-anchor-id="${id}">`)
    .replace(MARKER_CLOSE_RE_G, () => `</span>`);
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
  return text.replace(ANCHOR_OPEN_OR_CLOSE, (match, id?: string) => {
    if (id) {
      stack.push(id);
      return `<!-- fmc:${id} -->`;
    }
    const popped = stack.pop();
    if (!popped) return match; // unrelated </span>; leave it
    return `<!-- /fmc:${popped} -->`;
  });
}
