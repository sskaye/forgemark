// The comment id of the anchor a DOM node sits in, or null.
//
// Anchored passages carry `data-anchor-id` on the element that wraps
// them — a span in the Markdown editor, a span or the block itself in a
// report frame. Four copies of this walk existed; this is the one.
export function anchorIdOf(node: EventTarget | Node | null): number | null {
  if (node == null || typeof node !== "object" || !("nodeType" in node)) return null;
  const n = node as Node;
  const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
  const anchor = el?.closest?.("[data-anchor-id]");
  const raw = anchor?.getAttribute("data-anchor-id");
  const id = raw == null ? NaN : Number(raw);
  return Number.isFinite(id) ? id : null;
}
