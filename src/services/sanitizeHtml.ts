// The part of a raw HTML block the page may show. The file keeps the
// block as written; this is display only, the same idea as GitHub's tag
// filter: nothing that runs, loads, or frames, and no event handlers.

const DROPPED = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "BASE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "APPLET",
  "NOSCRIPT",
  "TEMPLATE",
  "TITLE",
]);

const URL_ATTRS = new Set(["href", "src", "srcset", "action", "formaction", "poster", "data"]);

function safeUrl(value: string): boolean {
  return !/^\s*(javascript|vbscript|data:text\/html)/i.test(value);
}

// The sanitized body of `html`, as a fragment of `doc`'s own document.
export function sanitizeHtml(html: string, doc: Document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    const clean = sanitizeNode(child, doc);
    if (clean) fragment.appendChild(clean);
  }
  return fragment;
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.importNode(node, false);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  if (DROPPED.has(el.tagName)) return null;
  const out = doc.createElement(el.tagName.toLowerCase());
  for (const attr of Array.from(el.attributes)) {
    if (/^on/i.test(attr.name)) continue;
    if (URL_ATTRS.has(attr.name.toLowerCase()) && !safeUrl(attr.value)) continue;
    out.setAttribute(attr.name, attr.value);
  }
  for (const child of Array.from(el.childNodes)) {
    const clean = sanitizeNode(child, doc);
    if (clean) out.appendChild(clean);
  }
  return out;
}
