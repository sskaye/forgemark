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
