// A comment anchor's two edges, as inline nodes.
//
// An anchored passage in the file is `<!-- fmc:N -->…<!-- /fmc:N -->`.
// The editor used to carry that as a mark on the text between, and
// marks rank: bold sat inside the anchor, so the markers came back out
// inside the `**` and the anchor shrank on the next pass. An edge that
// is a node has a position of its own; it serializes exactly where it
// sits, and typing in the passage never moves it.
//
// The display form is `<fm-anchor data-edge="open" data-id="N"></fm-anchor>`
// (markers-display.ts puts it in; markdown-it passes it through as
// inline HTML). An open/close pair with nothing but a tag between never
// starts an HTML block, which a lone `<span …>` at a line start did.
//
// The highlight between a pair is a decoration carrying `data-anchor-id`,
// so the click, hover, and scroll wiring that keys off that attribute is
// unchanged. The focused and hovered comment are part of the decoration
// too (`setAnchorHighlight`): a class toggled on the span from outside
// is an attribute change ProseMirror's observer answers by redrawing
// the text without it. Three plugins keep edges honest:
//
//   - Backspace and Delete beside an edge remove the character beyond
//     it instead of the edge, so the passage shrinks the way a marked
//     one did rather than losing its comment.
//   - After any change, an edge without its partner (a selection that
//     swallowed one) is removed too; the comment reattaches by its
//     recorded text instead of leaving a stray marker in the file.
//   - Pasting content that carries an edge of an anchor already in the
//     document drops the copy; moving one by cut and paste keeps it.

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";

export const ANCHOR_EDGE = "anchorEdge";

type Edge = "open" | "close";

interface SerializerState {
  write(text: string): void;
}

export const AnchorEdge = Node.create({
  name: ANCHOR_EDGE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      edge: {
        default: "open",
        parseHTML: (el: HTMLElement): Edge =>
          el.getAttribute("data-edge") === "close" ? "close" : "open",
        renderHTML: (attrs: { edge: Edge }) => ({ "data-edge": attrs.edge }),
      },
      anchorId: {
        default: "0",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-id") ?? "0",
        renderHTML: (attrs: { anchorId: string }) => ({ "data-id": String(attrs.anchorId) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "fm-anchor[data-edge]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["fm-anchor", mergeAttributes(HTMLAttributes, { class: "fm-anchor-edge" })];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          state.write(markerFor(node));
        },
        parse: {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteBeside(this.editor, -1),
      Delete: () => deleteBeside(this.editor, 1),
    };
  },

  addProseMirrorPlugins() {
    return [highlightPlugin(), balancePlugin(), pastePlugin()];
  },
});

export function markerFor(node: PMNode): string {
  const id = String(node.attrs.anchorId);
  return node.attrs.edge === "close" ? `<!-- /fmc:${id} -->` : `<!-- fmc:${id} -->`;
}

// The editor-side form of one marker.
export function anchorElement(edge: Edge, id: number | string): string {
  return `<fm-anchor data-edge="${edge}" data-id="${id}"></fm-anchor>`;
}

export type AnchorEdgeAt = { pos: number; id: number; edge: Edge };

export function anchorEdges(doc: PMNode): AnchorEdgeAt[] {
  const edges: AnchorEdgeAt[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== ANCHOR_EDGE) return !node.isLeaf;
    const id = Number(node.attrs.anchorId);
    if (Number.isFinite(id)) edges.push({ pos, id, edge: node.attrs.edge as Edge });
    return false;
  });
  return edges;
}

// The passage between a pair: `from` is the position after the open
// edge, `to` the position of the close edge.
export type AnchorRange = { id: number; from: number; to: number };

export function anchorRanges(doc: PMNode): AnchorRange[] {
  const open = new Map<number, number>();
  const ranges: AnchorRange[] = [];
  const done = new Set<number>();
  for (const e of anchorEdges(doc)) {
    if (done.has(e.id)) continue;
    if (e.edge === "open") {
      if (!open.has(e.id)) open.set(e.id, e.pos);
    } else if (open.has(e.id)) {
      ranges.push({ id: e.id, from: open.get(e.id)! + 1, to: e.pos });
      done.add(e.id);
    }
  }
  return ranges;
}

// Edges that belong to no pair: a second open or close for an id, a
// close before its open, one half of a pair, or both halves of a pair
// with nothing between them.
export function strayEdges(doc: PMNode): number[] {
  const edges = anchorEdges(doc);
  const keep = new Set<number>();
  const open = new Map<number, number>();
  const done = new Set<number>();
  for (const e of edges) {
    if (done.has(e.id)) continue;
    if (e.edge === "open") {
      if (!open.has(e.id)) open.set(e.id, e.pos);
    } else if (open.has(e.id)) {
      const openPos = open.get(e.id)!;
      if (e.pos > openPos + 1) {
        keep.add(openPos);
        keep.add(e.pos);
      }
      done.add(e.id);
    }
  }
  return edges.filter((e) => !keep.has(e.pos)).map((e) => e.pos);
}

// The text of a range as the reader sees it: edges contribute nothing,
// other leaves (an image, a hard break) a space.
export function plainText(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, " ", (leaf) => (leaf.type.name === ANCHOR_EDGE ? "" : " "));
}

// A transaction that anchors `from`–`to` as comment `id`: a close edge
// at `to`, then an open edge at `from`. Either end inside an inline code
// span moves out to the span's boundary; a marker inside backticks would
// be code. Each edge takes the marks both of its neighbours share, so
// it sits inside emphasis only when the emphasis continues across it.
export function anchorEdgesTransaction(
  state: EditorState,
  from: number,
  to: number,
  id: number,
): Transaction {
  const type = state.schema.nodes[ANCHOR_EDGE];
  const start = outOfCode(state.doc, from, -1);
  const end = outOfCode(state.doc, to, 1);
  const tr = state.tr;
  const edge = (kind: Edge, pos: number) =>
    type.create({ edge: kind, anchorId: String(id) }, undefined, sharedMarks(tr.doc.resolve(pos)));
  tr.insert(end, edge("close", end));
  tr.insert(start, edge("open", start));
  return tr;
}

function sharedMarks($pos: ResolvedPos) {
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  if (!before || !after) return [];
  return before.marks.filter((m) => m.isInSet(after.marks));
}

const isCodeText = (node: PMNode | null) =>
  node != null && node.isText && node.marks.some((m) => m.type.name === "code");

function outOfCode(doc: PMNode, pos: number, dir: -1 | 1): number {
  let $pos = doc.resolve(pos);
  while (isCodeText($pos.nodeBefore) && isCodeText($pos.nodeAfter)) {
    pos = dir < 0 ? pos - $pos.nodeBefore!.nodeSize : pos + $pos.nodeAfter!.nodeSize;
    $pos = doc.resolve(pos);
  }
  return pos;
}

// Backspace (dir -1) or Delete (dir 1) with the caret against an edge:
// remove the character on the far side of the edge, or of a run of
// edges, and leave the edges where they are. Anything else falls
// through to the editor's own handling.
function deleteBeside(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const { selection } = state;
  if (!selection.empty) return false;
  const $pos = selection.$from;
  if (!$pos.parent.isTextblock || $pos.textOffset > 0) return false;
  const parent = $pos.parent;
  let index = dir < 0 ? $pos.index() - 1 : $pos.index();
  let pos = $pos.pos;
  let node: PMNode | null = index >= 0 && index < parent.childCount ? parent.child(index) : null;
  if (!node || node.type.name !== ANCHOR_EDGE) return false;
  while (node && node.type.name === ANCHOR_EDGE) {
    pos += dir * node.nodeSize;
    index += dir;
    node = index >= 0 && index < parent.childCount ? parent.child(index) : null;
  }
  if (!node || !node.isText || !node.text) return false;
  const len = dir < 0 ? lastCharLength(node.text) : firstCharLength(node.text);
  const from = dir < 0 ? pos - len : pos;
  editor.view.dispatch(state.tr.delete(from, from + len).scrollIntoView());
  return true;
}

function lastCharLength(text: string): number {
  const code = text.charCodeAt(text.length - 1);
  return text.length >= 2 && code >= 0xdc00 && code <= 0xdfff ? 2 : 1;
}

function firstCharLength(text: string): number {
  const code = text.charCodeAt(0);
  return text.length >= 2 && code >= 0xd800 && code <= 0xdbff ? 2 : 1;
}

type Highlight = { focused: number | null; hovered: number | null; set: DecorationSet };

const highlightKey = new PluginKey<Highlight>("anchorHighlight");

// Tell the editor which comment is focused and which hovered; the
// highlights (and whole-block code anchors) take the matching classes.
export function setAnchorHighlight(
  view: EditorView,
  focused: number | null,
  hovered: number | null,
): void {
  const current = highlightKey.getState(view.state);
  if (!current || (current.focused === focused && current.hovered === hovered)) return;
  view.dispatch(view.state.tr.setMeta(highlightKey, { focused, hovered }));
}

function stateClasses(id: number, focused: number | null, hovered: number | null): string {
  return (id === focused ? " is-focused" : "") + (id === hovered ? " is-hovered" : "");
}

function highlight(doc: PMNode, focused: number | null, hovered: number | null): DecorationSet {
  const decorations = anchorRanges(doc)
    .filter((r) => r.to > r.from)
    .map((r) =>
      Decoration.inline(r.from, r.to, {
        class: "fm-anchor" + stateClasses(r.id, focused, hovered),
        "data-anchor-id": String(r.id),
      }),
    );
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return !node.isLeaf;
    const id = Number(node.attrs.anchorId);
    const classes = Number.isFinite(id) ? stateClasses(id, focused, hovered).trim() : "";
    if (classes) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function highlightPlugin() {
  return new Plugin<Highlight>({
    key: highlightKey,
    state: {
      init: (_config, state) => ({
        focused: null,
        hovered: null,
        set: highlight(state.doc, null, null),
      }),
      apply: (tr, old) => {
        const meta = tr.getMeta(highlightKey) as Pick<Highlight, "focused" | "hovered"> | undefined;
        if (!meta && !tr.docChanged) return old;
        const focused = meta ? meta.focused : old.focused;
        const hovered = meta ? meta.hovered : old.hovered;
        return { focused, hovered, set: highlight(tr.doc, focused, hovered) };
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.set;
      },
    },
  });
}

function balancePlugin() {
  return new Plugin({
    key: new PluginKey("anchorBalance"),
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const stray = strayEdges(state.doc);
      if (stray.length === 0) return null;
      const tr = state.tr;
      for (const pos of stray.sort((a, b) => b - a)) tr.delete(pos, pos + 1);
      return tr;
    },
  });
}

function pastePlugin() {
  return new Plugin({
    key: new PluginKey("anchorPaste"),
    props: {
      transformPasted(slice, view) {
        const present = new Set(anchorEdges(view.state.doc).map((e) => e.id));
        if (present.size === 0) return slice;
        return new Slice(withoutEdges(slice.content, present), slice.openStart, slice.openEnd);
      },
    },
  });
}

function withoutEdges(fragment: Fragment, ids: Set<number>): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === ANCHOR_EDGE) {
      if (!ids.has(Number(node.attrs.anchorId))) nodes.push(node);
    } else if (node.content.size > 0) {
      nodes.push(node.copy(withoutEdges(node.content, ids)));
    } else {
      nodes.push(node);
    }
  });
  return Fragment.fromArray(nodes);
}
