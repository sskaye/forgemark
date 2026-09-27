import type { Node as PMNode } from "@tiptap/pm/model";

// Whole-block comment anchors, shared by every block the file cannot
// put markers inside: a code fence, a `$$` equation or math fence, a
// Mermaid diagram. Such a comment is stored with the marker pair on its
// own lines around the block:
//
//   <!-- fmc:N -->
//   ```lang
//   …
//   ```
//   <!-- /fmc:N -->
//
// On display, `blockAnchorsToInfoString` (src/format/markers-display.ts)
// moves the id onto the block's opening line (`lang fmc=N`, `$$ fmc=N`),
// markdownExtras strips it back off into the token and renders it as
// `data-anchor-id`, and the node keeps it as its `anchorId` attribute.
// Writing the node puts the markers back.
//
// A block node opts in by spreading `blockAnchorAttribute` into its
// attributes and serializing through `serializeBlockAnchored`. Every
// other part of the app — selection, highlighting, click and hover —
// finds such nodes with `isBlockAnchored`, so a new kind of block needs
// nothing more.

interface SerializerState {
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: unknown): void;
}

export const blockAnchorAttribute = {
  anchorId: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-anchor-id"),
    renderHTML: (attrs: { anchorId: string | null }) =>
      attrs.anchorId == null ? {} : { "data-anchor-id": String(attrs.anchorId) },
  },
};

export function isBlockAnchored(node: PMNode): boolean {
  return node.isBlock && node.type.spec.attrs?.anchorId !== undefined;
}

// What a node reads as, for a comment's anchor text: the node's own
// `renderText` (an equation's TeX, an image's alt text), or, for a node
// with content, its text.
export function nodeText(node: PMNode): string {
  const toText = (node.type.spec as { toText?: (props: { node: PMNode }) => string }).toText;
  if (toText) return toText({ node });
  return node.isLeaf ? "" : node.textContent;
}

// Write a block, with its marker pair around it when it is anchored.
// `write` writes the block itself, each line through the state so a
// list item's or a quote's prefix goes on every one.
export function serializeBlockAnchored(
  state: SerializerState,
  node: PMNode | { attrs: Record<string, unknown> },
  write: () => void,
): void {
  const id = node.attrs.anchorId;
  if (id != null) {
    state.write(`<!-- fmc:${String(id)} -->`);
    state.write("\n");
  }
  write();
  if (id != null) {
    state.ensureNewLine();
    state.write(`<!-- /fmc:${String(id)} -->`);
  }
  state.closeBlock(node);
}

// Write lines through the state, one at a time (see above).
export function writeLines(state: SerializerState, lines: string[]): void {
  lines.forEach((line, i) => {
    state.write(line);
    if (i < lines.length - 1) state.write("\n");
  });
}
