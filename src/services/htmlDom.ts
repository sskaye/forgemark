// The DOM half of HTML anchoring.
//
// `format/html/textmap.ts` produces the rendered text of the *source*
// together with a per-character source offset. This module produces the
// rendered text of the *DOM* and locates positions within it. The two
// meet on a single shared coordinate: an index into the concatenated
// rendered text.
//
// Going through a character index rather than node identity is what
// makes this robust. Forgemark rewrites the iframe's DOM at display time
// — wrapping anchored passages in `<span data-anchor-id>` so they can be
// highlighted — which splits text nodes and would invalidate any map
// keyed on the nodes themselves. Wrapping changes no characters, so the
// index is stable across it.
//
// The skip set must match `textmap.ts` exactly or every offset after the
// first skipped element is wrong.

const SKIP_CONTENT = new Set(["SCRIPT", "STYLE", "TITLE", "TEXTAREA", "NOSCRIPT"]);

// Walk text nodes in document order, skipping non-prose elements.
export function walkTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node as Text);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && SKIP_CONTENT.has((node as Element).tagName)) {
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(root);
  return out;
}

// The document's rendered text, as the shared coordinate space.
export function renderedText(root: Node): string {
  return walkTextNodes(root)
    .map((n) => n.data)
    .join("");
}

// Character index of a DOM position, or null when the position isn't
// inside the walked text (e.g. it sits in a skipped element).
export function textIndexOf(root: Node, container: Node, offset: number): number | null {
  const nodes = walkTextNodes(root);

  if (container.nodeType === Node.TEXT_NODE) {
    let total = 0;
    for (const node of nodes) {
      if (node === container) return total + Math.min(offset, node.data.length);
      total += node.data.length;
    }
    return null;
  }

  // An element container: `offset` counts child nodes, so resolve to the
  // first text position at or after that child.
  const children = Array.from(container.childNodes);
  const target = children[offset];
  if (!target) {
    // Position is at the end of the element — take the end of its last
    // text descendant.
    const inside = walkTextNodes(container);
    const last = inside[inside.length - 1];
    if (!last) return null;
    const at = textIndexOf(root, last, last.data.length);
    return at;
  }
  const inside = walkTextNodes(target);
  const first = inside[0];
  if (!first) return null;
  return textIndexOf(root, first, 0);
}

// The character range a selection covers, normalised so from <= to.
// Returns null for collapsed or unmappable selections.
export function selectionTextRange(
  root: Node,
  range: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number },
): { from: number; to: number } | null {
  const start = textIndexOf(root, range.startContainer, range.startOffset);
  const end = textIndexOf(root, range.endContainer, range.endOffset);
  if (start == null || end == null) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) return null;
  return { from, to };
}

// Inverse: a DOM Range covering a character range. Used to scroll an
// anchor into view and to preview a reattachment candidate.
export function rangeForTextIndices(
  doc: Document,
  root: Node,
  from: number,
  to: number,
): Range | null {
  const nodes = walkTextNodes(root);
  let total = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of nodes) {
    const len = node.data.length;
    if (startNode == null && from < total + len) {
      startNode = node;
      startOffset = from - total;
    }
    if (endNode == null && to <= total + len) {
      endNode = node;
      endOffset = to - total;
      break;
    }
    total += len;
  }
  if (!startNode || !endNode) return null;
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

// The nearest ancestor that can carry an element anchor — a figure,
// table, chart, or other self-contained block. Returns null when the
// node isn't inside one.
//
// Ordered most-specific first: a `<figure>` wrapping a chart is the unit
// a reviewer means when they click it, not the `<svg>` inside it.
const ELEMENT_ANCHOR_TAGS = ["FIGURE", "TABLE", "SVG", "BLOCKQUOTE", "PRE", "IMG", "VIDEO"];

export function elementAnchorTarget(node: Node | null): Element | null {
  let el: Element | null =
    node == null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  let best: Element | null = null;
  while (el) {
    if (ELEMENT_ANCHOR_TAGS.includes(el.tagName)) best = el;
    el = el.parentElement;
  }
  return best;
}

// A short human-readable description of an element anchor, used as
// `anchor_text` so the sidebar card and the reattach flow have something
// meaningful to show. Prefers the caption a report author already wrote.
export function describeElement(el: Element): string {
  const caption = el.querySelector("figcaption, caption");
  const captionText = caption?.textContent?.trim();
  if (captionText) return collapse(captionText);

  const heading = el.querySelector("th");
  const headingText = heading?.textContent?.trim();
  if (headingText) return collapse(`${el.tagName.toLowerCase()}: ${headingText}`);

  const own = el.textContent?.trim();
  if (own) return collapse(own);
  return el.tagName.toLowerCase();
}

function collapse(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}
