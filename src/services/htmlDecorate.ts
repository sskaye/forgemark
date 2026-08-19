// Display-time anchor decoration for HTML documents.
//
// The Markdown path rewrites `<!-- fmc:N -->` into `<span
// data-anchor-id>` in the *text* before handing it to the editor
// (`bodyWithAnchorSpans`). HTML gets the same idea one layer down: the
// browser has already parsed the markers into Comment nodes, so the
// wrapping happens in the DOM and the source string is never touched.
//
// This is strictly a display transformation. Nothing here is ever
// serialized back — the source is only ever spliced at byte offsets —
// which is why it is safe to produce several spans for one anchor.
//
// Two anchor shapes, matching the two ways the format is written:
//
//   inline   `<!-- fmc:1 -->some <b>text</b><!-- /fmc:1 -->`
//            wraps each text node in the range, so a passage crossing
//            tags highlights as one continuous run.
//
//   element  markers on their own lines around a <figure> or <table>.
//            Marks the element itself, which is the only way to comment
//            on a chart — the thing a reviewer most wants to point at in
//            a generated report has no text to select.

const OPEN_RE = /^\s*fmc:(\d+)\s*$/;
const CLOSE_RE = /^\s*\/fmc:(\d+)\s*$/;

const SVG_NS = "http://www.w3.org/2000/svg";
const SKIP_PARENTS = new Set(["SCRIPT", "STYLE", "TITLE", "TEXTAREA", "NOSCRIPT"]);

export type DecoratedAnchor = {
  id: number;
  kind: "inline" | "element";
};

// Walk the document, pair marker comments, and mark what they enclose.
// Returns what it found so the caller can tell an anchor that rendered
// from one that didn't.
export function decorateAnchors(doc: Document): DecoratedAnchor[] {
  const opens = new Map<number, Comment>();
  const pairs: { id: number; open: Comment; close: Comment }[] = [];

  // Walk from the Document, not from <body>. A marker that opens before
  // the first element — which is where an element anchor on the first
  // figure of a fragment ends up — is parsed as a child of the document
  // itself, and a body-rooted walk would silently drop the pair.
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);

  for (const node of comments) {
    const data = node.data;
    const openMatch = OPEN_RE.exec(data);
    if (openMatch) {
      opens.set(Number(openMatch[1]), node);
      continue;
    }
    const closeMatch = CLOSE_RE.exec(data);
    if (closeMatch) {
      const id = Number(closeMatch[1]);
      const open = opens.get(id);
      if (open) {
        pairs.push({ id, open, close: node });
        opens.delete(id);
      }
    }
  }

  const out: DecoratedAnchor[] = [];
  for (const pair of pairs) {
    out.push({ id: pair.id, kind: decoratePair(doc, pair.id, pair.open, pair.close) });
  }
  return out;
}

function decoratePair(
  doc: Document,
  id: number,
  open: Comment,
  close: Comment,
): "inline" | "element" {
  const between = nodesBetween(open, close);

  // An element anchor is markers wrapping whole blocks: the only things
  // at the markers' own level are elements and whitespace.
  if (open.parentNode && open.parentNode === close.parentNode) {
    const topLevel = between.filter((n) => n.parentNode === open.parentNode);
    const elements = topLevel.filter((n) => n.nodeType === Node.ELEMENT_NODE) as Element[];
    const prose = topLevel.filter(
      (n) => n.nodeType === Node.TEXT_NODE && (n as Text).data.trim().length > 0,
    );
    if (elements.length > 0 && prose.length === 0) {
      for (const el of elements) el.setAttribute("data-anchor-id", String(id));
      return "element";
    }
  }

  // Inline: wrap every text node the markers enclose. Collect first,
  // then mutate — wrapping rewrites the tree we are walking.
  const texts = between.filter(
    (n) =>
      n.nodeType === Node.TEXT_NODE &&
      (n as Text).data.length > 0 &&
      !SKIP_PARENTS.has(n.parentElement?.tagName ?? "") &&
      // An HTML <span> inside an <svg> is in the wrong namespace and
      // would not render. Charts are commented on as elements instead.
      n.parentElement?.namespaceURI !== SVG_NS,
  ) as Text[];

  for (const text of texts) {
    const span = doc.createElement("span");
    span.setAttribute("data-anchor-id", String(id));
    text.parentNode?.replaceChild(span, text);
    span.appendChild(text);
  }
  return "inline";
}

// Every node strictly between two nodes, in document order.
function nodesBetween(start: Node, end: Node): Node[] {
  const out: Node[] = [];
  let node = nextInDocumentOrder(start);
  while (node && node !== end) {
    out.push(node);
    node = nextInDocumentOrder(node);
  }
  return out;
}

function nextInDocumentOrder(node: Node): Node | null {
  if (node.firstChild) return node.firstChild;
  let current: Node | null = node;
  while (current) {
    if (current.nextSibling) return current.nextSibling;
    current = current.parentNode;
  }
  return null;
}

// Reflect focus / hover / resolved state onto the decorated anchors.
// Imperative because the iframe's DOM isn't React's to own.
export function applyAnchorState(
  doc: Document,
  focusedId: number | null,
  hoveredId: number | null,
  resolvedIds: ReadonlySet<number>,
): void {
  const all = doc.querySelectorAll<HTMLElement>("[data-anchor-id]");
  all.forEach((el) => {
    const raw = el.getAttribute("data-anchor-id");
    const id = raw == null ? null : Number(raw);
    el.classList.toggle("is-focused", id === focusedId);
    el.classList.toggle("is-hovered", id === hoveredId);
    el.classList.toggle("is-resolved", id != null && resolvedIds.has(id));
  });
}

// The first decorated element for a comment, used to scroll it into view.
export function anchorElement(doc: Document, id: number): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-anchor-id="${id}"]`);
}

// Stylesheet injected into the iframe. Kept deliberately narrow: it must
// style Forgemark's own additions without disturbing a report that has
// its own opinions about everything. `all: revert` would be too blunt —
// these selectors only ever match elements or attributes we added.
export function anchorStylesheet(tokens: {
  anchorBg: string;
  anchorBgHover: string;
  anchorBgFocus: string;
  anchorBgResolved: string;
  anchorUnderline: string;
  accent: string;
  surface: string;
  text: string;
  border: string;
}): string {
  return `
[data-anchor-id] {
  background: ${tokens.anchorBg};
  border-radius: 1px;
  cursor: default;
  transition: background-color 120ms ease-out;
}
[data-anchor-id].is-hovered { background: ${tokens.anchorBgHover}; }
[data-anchor-id].is-focused {
  background: ${tokens.anchorBgFocus};
  box-shadow: inset 0 -1px 0 ${tokens.anchorUnderline};
}
[data-anchor-id].is-resolved { background: ${tokens.anchorBgResolved}; }

/* Block-level anchors (figures, tables, charts) read better as an
   accent rail than as a wash over a whole chart. */
figure[data-anchor-id], table[data-anchor-id], pre[data-anchor-id],
blockquote[data-anchor-id], img[data-anchor-id], svg[data-anchor-id] {
  background: transparent;
  box-shadow: -6px 0 0 ${tokens.anchorUnderline};
}
figure[data-anchor-id].is-hovered, table[data-anchor-id].is-hovered,
pre[data-anchor-id].is-hovered, blockquote[data-anchor-id].is-hovered,
img[data-anchor-id].is-hovered, svg[data-anchor-id].is-hovered {
  background: ${tokens.anchorBgHover};
}
figure[data-anchor-id].is-focused, table[data-anchor-id].is-focused,
pre[data-anchor-id].is-focused, blockquote[data-anchor-id].is-focused,
img[data-anchor-id].is-focused, svg[data-anchor-id].is-focused {
  background: ${tokens.anchorBgFocus};
}

/* The affordance for commenting on something with no text to select. */
.fm-element-target {
  position: absolute;
  z-index: 2147483000;
  font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
  letter-spacing: 0.02em;
  padding: 5px 9px;
  border-radius: 5px;
  border: 1px solid ${tokens.border};
  background: ${tokens.surface};
  color: ${tokens.text};
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  cursor: pointer;
  opacity: 0;
  transition: opacity 100ms ease-out;
}
.fm-element-target[data-visible="true"] { opacity: 1; }
.fm-element-target:hover { border-color: ${tokens.accent}; color: ${tokens.accent}; }

/* Forgemark owns selection colour here so a report's own ::selection
   rule can't make a review selection invisible. */
::selection { background: ${tokens.anchorBgFocus}; }
`;
}
