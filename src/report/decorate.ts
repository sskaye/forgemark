// Display-time anchor decoration for HTML documents, run inside the
// report frame by the bridge.
//
// The Markdown path turns `<!-- fmc:N -->` into edge nodes in the
// editor. HTML gets the same idea one layer down: the browser has
// already parsed the markers into Comment nodes, so the wrapping happens
// in the DOM and the source string is never touched.
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
//
//   passage  markers around an element a script fills at load, with the
//            comment about text inside it. The element is not marked;
//            the text is found in its rendered content and wrapped, and
//            found again after the script redraws it.
//
// Every step is idempotent, since the bridge decorates again whenever
// the document changes.

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
// from one that didn't. `passageIds` name the pairs whose element must
// not be marked itself; `decoratePassage` handles their text.
export function decorateAnchors(
  doc: Document,
  passageIds: ReadonlySet<number> = new Set(),
): DecoratedAnchor[] {
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
    out.push({
      id: pair.id,
      kind: decoratePair(doc, pair.id, pair.open, pair.close, passageIds.has(pair.id)),
    });
  }
  return out;
}

// The marker comments for `id`, if the document has them.
export function markerPair(doc: Document, id: number): { open: Comment; close: Comment } | null {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  let open: Comment | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Comment;
    const o = OPEN_RE.exec(node.data);
    if (o && Number(o[1]) === id) open = node;
    const c = CLOSE_RE.exec(node.data);
    if (c && Number(c[1]) === id && open) return { open, close: node };
  }
  return null;
}

function decoratePair(
  doc: Document,
  id: number,
  open: Comment,
  close: Comment,
  passage: boolean,
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
      for (const el of elements) {
        if (passage) el.setAttribute("data-fm-passage-host", String(id));
        else el.setAttribute("data-anchor-id", String(id));
      }
      return "element";
    }
  }

  // Inline: wrap every text node the markers enclose. Collect first,
  // then mutate — wrapping rewrites the tree we are walking. A text
  // already wrapped for this anchor is left as it is.
  const texts = between.filter(
    (n) =>
      n.nodeType === Node.TEXT_NODE &&
      (n as Text).data.length > 0 &&
      !SKIP_PARENTS.has(n.parentElement?.tagName ?? "") &&
      n.parentElement?.getAttribute("data-anchor-id") !== String(id) &&
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

// Highlight `text` inside the element a passage anchor wraps, or
// nothing when the element does not show it at the moment (a tab not
// selected, a range not chosen). Wraps that no longer match are undone
// first, so a redraw of the element is followed by a fresh search.
export function decoratePassage(doc: Document, id: number, text: string): boolean {
  const host = doc.querySelector(`[data-fm-passage-host="${id}"]`);
  if (!host) return false;
  const wanted = text.replace(/\s+/g, " ").trim();
  const current = Array.from(host.querySelectorAll(`[data-anchor-id="${id}"]`));
  if (current.length > 0) {
    const shown = current
      .map((el) => el.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (shown === wanted) return true;
    for (const el of current) unwrapSpan(el);
  }
  if (wanted.length === 0) return false;

  // Match on the rendered text of the element, whitespace collapsed,
  // then map the match back to text nodes.
  const nodes = textNodesUnder(host);
  let joined = "";
  const starts: number[] = [];
  for (const node of nodes) {
    starts.push(joined.length);
    joined += node.data;
  }
  const at = collapsedIndexOf(joined, wanted);
  if (!at) return false;
  const [from, to] = at;
  const spans: Element[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nodeStart = starts[i];
    const nodeEnd = nodeStart + nodes[i].data.length;
    if (nodeEnd <= from || nodeStart >= to) continue;
    let node = nodes[i];
    // Cut the node down to the part inside the match.
    const head = Math.max(0, from - nodeStart);
    const tail = Math.max(0, nodeEnd - to);
    if (head > 0) node = node.splitText(head);
    if (tail > 0) node.splitText(node.data.length - tail);
    if (node.parentElement?.namespaceURI === SVG_NS) continue;
    const span = doc.createElement("span");
    span.setAttribute("data-anchor-id", String(id));
    node.parentNode?.replaceChild(span, node);
    span.appendChild(node);
    spans.push(span);
  }
  return spans.length > 0;
}

// Where `wanted` (whitespace collapsed) sits in `haystack` (raw), as raw
// offsets, or null.
function collapsedIndexOf(haystack: string, wanted: string): [number, number] | null {
  const map: number[] = [];
  let collapsed = "";
  let pendingSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      pendingSpace = collapsed.length > 0;
      continue;
    }
    if (pendingSpace) {
      collapsed += " ";
      map.push(i);
      pendingSpace = false;
    }
    collapsed += ch;
    map.push(i);
  }
  const at = collapsed.indexOf(wanted);
  if (at < 0) return null;
  return [map[at], map[at + wanted.length - 1] + 1];
}

function textNodesUnder(root: Node): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (SKIP_PARENTS.has(node.parentElement?.tagName ?? "")) continue;
    if (node.parentElement?.closest("[data-forgemark]")) continue;
    out.push(node);
  }
  return out;
}

function unwrapSpan(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

// Undo everything `decorateAnchors` did for one comment and take its
// markers out, for a comment that was deleted or floated.
export function removeAnchor(doc: Document, id: number): void {
  const pair = markerPair(doc, id);
  pair?.open.remove();
  pair?.close.remove();
  for (const el of Array.from(doc.querySelectorAll(`[data-anchor-id="${id}"]`))) {
    if (el.tagName === "SPAN" && el.attributes.length === 1) unwrapSpan(el);
    else el.removeAttribute("data-anchor-id");
  }
  for (const el of Array.from(doc.querySelectorAll(`[data-fm-passage-host="${id}"]`))) {
    el.removeAttribute("data-fm-passage-host");
  }
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

/* Forgemark owns selection colour here so a report's own ::selection
   rule can't make a review selection invisible. */
::selection { background: ${tokens.anchorBgFocus}; }

/* The way to comment on a chart or a table: a quiet button the bridge
   places beside each block. */
button[data-forgemark="block"] {
  position: absolute;
  z-index: 2147483000;
  box-sizing: border-box;
  margin: 0;
  font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0.02em;
  color: ${tokens.text};
  background: ${tokens.surface};
  border: 0.5px solid ${tokens.border};
  border-radius: 5px;
  padding: 4px 8px;
  cursor: default;
  opacity: 0.6;
  transition: opacity 100ms ease-out, color 100ms ease-out, border-color 100ms ease-out;
}
button[data-forgemark="block"]:hover,
button[data-forgemark="block"]:focus-visible {
  opacity: 1;
  color: ${tokens.accent};
  border-color: ${tokens.accent};
}
`;
}
