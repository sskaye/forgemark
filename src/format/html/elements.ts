// Locating a whole element in an HTML source.
//
// Two callers need this, and both are about surviving a regenerated
// report — the dominant HTML workflow, where the agent reruns and writes
// a new file so every marker is gone:
//
//   - `anchor_selector`, the id a comment recorded when it was made. If
//     the report still gives that figure the same id, reattachment is
//     exact and instant instead of a fuzzy text match.
//   - `anchor_kind: element`, where the anchor is a figure or table and
//     the marker pair must wrap the whole block. Matching the caption as
//     *text* would reattach the comment to the caption line rather than
//     to the chart.
//
// Only the selector shapes Forgemark itself writes are supported —
// `#id` and `#id tag`. This is deliberately not a CSS engine: a selector
// we didn't write is a selector we can't promise to honour, and a wrong
// match here silently points a comment at the wrong chart.

import { parse } from "parse5";
import { BLOCK_TAGS } from "./blockTags";

export type ElementSpan = { start: number; end: number; text: string };

type P5Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  parentNode?: P5Node | null;
  content?: P5Node;
  sourceCodeLocation?: { startOffset: number; endOffset: number } | null;
};

const SKIP_CONTENT = new Set(["script", "style", "title", "textarea", "noscript"]);

// Resolve `#id` or `#id tag` against the source. Returns the element's
// full span, end tag included, ready for a marker pair to wrap.
export function findBySelector(html: string, selector: string): ElementSpan | null {
  const match = /^#([A-Za-z][\w-]*)(?:\s+([a-zA-Z][\w-]*))?$/.exec(selector.trim());
  if (!match) return null;
  const [, id, descendantTag] = match;

  const root = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const host = findFirst(root, (node) => attr(node, "id") === id);
  if (!host) return null;

  const target = descendantTag
    ? findFirst(host, (node) => (node.tagName ?? "").toLowerCase() === descendantTag.toLowerCase())
    : host;
  return target ? spanOf(html, target) : null;
}

// The innermost element enclosing a source range that has an id, as the
// `#id` selector `findBySelector` reads, or undefined if none does. A
// comment on a passage records it as `anchor_scope`: a report that
// repeats a sentence in every tab usually gives each tab an id, and the
// id tells the copies apart when the words around them can't.
export function enclosingScope(html: string, start: number, end: number): string | undefined {
  const root = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  return scopeWithin(root, start, end, undefined)?.scope;
}

// Descend through the elements that contain the range, keeping the last
// usable id seen. Elements the parser implied (an `<html>` or `<body>`
// the source never wrote) have no location; they are looked through.
function scopeWithin(
  node: P5Node,
  start: number,
  end: number,
  scope: string | undefined,
): { scope?: string } | null {
  const children = (node.tagName === "template" ? node.content?.childNodes : node.childNodes) ?? [];
  for (const child of children) {
    if (child.tagName === undefined) continue;
    const loc = child.sourceCodeLocation;
    if (loc && !(loc.startOffset <= start && loc.endOffset >= end)) continue;
    const id = attr(child, "id");
    const here = id && /^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : scope;
    const inner = scopeWithin(child, start, end, here);
    if (inner) return inner;
    if (loc) return { scope: here };
  }
  return null;
}

// The innermost block element (`blockTags.ts`) enclosing a source range:
// what a reader takes as the passage's paragraph, list item or heading.
// In a table, the row: neighbouring cells of a row belong together, and a
// cell alone is usually just the passage.
export function enclosingBlockSpan(
  html: string,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const root = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  return blockWithin(root, start, end, undefined)?.block;
}

// Like `scopeWithin`: down through the elements that contain the range,
// keeping the innermost block seen, looking through elements the parser
// implied (no location) without stopping at one that leads elsewhere.
function blockWithin(
  node: P5Node,
  start: number,
  end: number,
  block: { start: number; end: number } | undefined,
): { block?: { start: number; end: number } } | null {
  const children = (node.tagName === "template" ? node.content?.childNodes : node.childNodes) ?? [];
  for (const child of children) {
    if (child.tagName === undefined) continue;
    const loc = child.sourceCodeLocation;
    if (loc && !(loc.startOffset <= start && loc.endOffset >= end)) continue;
    const tag = child.tagName.toLowerCase();
    const here =
      loc && BLOCK_TAGS.has(tag) && tag !== "td" && tag !== "th"
        ? { start: loc.startOffset, end: loc.endOffset }
        : block;
    const inner = blockWithin(child, start, end, here);
    if (inner) return inner;
    if (loc) return { block: here };
  }
  return null;
}

// Blocks a comment can be anchored to as a unit. Same list the DOM side
// uses to decide what a hover targets.
const BLOCK_ANCHORS = new Set(["figure", "table", "svg", "blockquote", "pre", "img", "video"]);

// Find the element whose rendered text best matches `text`. Used for an
// element anchor whose selector is missing or stale.
//
// "Best" is the *smallest* element that contains the text, which is what
// keeps a caption from resolving to <body>. Then, for a block anchor, we
// walk back *up* to the enclosing figure or table: a comment on "Figure
// 3" means the chart, and reattaching it to the caption line alone would
// leave the chart uncommented while looking like a success.
export function findByText(
  html: string,
  text: string,
  opts: { preferBlock?: boolean } = {},
): ElementSpan | null {
  const needle = normalize(text);
  if (needle.length === 0) return null;

  const root = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  let best: P5Node | null = null;
  let bestLength = Infinity;

  const visit = (node: P5Node) => {
    const tag = (node.tagName ?? "").toLowerCase();
    if (tag && SKIP_CONTENT.has(tag)) return;
    if (node.content) visit(node.content);
    for (const child of node.childNodes ?? []) visit(child);

    if (!node.tagName || !node.sourceCodeLocation) return;
    const rendered = normalize(textOf(node));
    if (!rendered.includes(needle)) return;
    if (rendered.length < bestLength) {
      best = node;
      bestLength = rendered.length;
    }
  };
  visit(root);
  if (!best) return null;

  const target = opts.preferBlock ? (enclosingBlock(best) ?? best) : best;
  return spanOf(html, target);
}

function enclosingBlock(node: P5Node): P5Node | null {
  let current: P5Node | null = node;
  while (current) {
    const tag = (current.tagName ?? "").toLowerCase();
    if (BLOCK_ANCHORS.has(tag) && current.sourceCodeLocation) return current;
    current = current.parentNode ?? null;
  }
  return null;
}

function spanOf(html: string, node: P5Node): ElementSpan | null {
  const loc = node.sourceCodeLocation;
  if (!loc) return null;
  return {
    start: loc.startOffset,
    end: loc.endOffset,
    text: html.slice(loc.startOffset, loc.endOffset),
  };
}

function findFirst(root: P5Node, predicate: (node: P5Node) => boolean): P5Node | null {
  let found: P5Node | null = null;
  const visit = (node: P5Node) => {
    if (found) return;
    if (node.tagName && predicate(node)) {
      found = node;
      return;
    }
    if (node.content) visit(node.content);
    for (const child of node.childNodes ?? []) {
      if (found) return;
      visit(child);
    }
  };
  visit(root);
  return found;
}

function attr(node: P5Node, name: string): string | null {
  return node.attrs?.find((a) => a.name === name)?.value ?? null;
}

function textOf(node: P5Node): string {
  if (node.nodeName === "#text") return node.value ?? "";
  const tag = (node.tagName ?? "").toLowerCase();
  if (tag && SKIP_CONTENT.has(tag)) return "";
  let out = "";
  if (node.content) out += textOf(node.content);
  for (const child of node.childNodes ?? []) out += textOf(child);
  return out;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
