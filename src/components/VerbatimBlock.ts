import { Node, mergeAttributes } from "@tiptap/core";

// A block the editor cannot hold — raw HTML: a comment, a <div>, a
// <details> — shown read-only and written back byte for byte.
//
// The editor used to drop these on the floor (an HTML comment) or
// mangle them (a <div> became its text). The body is split into blocks
// before it reaches the editor (src/format/blocks.ts); each raw-HTML
// block arrives as `<div data-fm-src="…">` carrying its own source,
// URL-encoded so it survives the attribute, and leaves the same way.

interface SerializerState {
  write(text: string): void;
  closeBlock(node: unknown): void;
}

export const VerbatimBlock = Node.create({
  name: "verbatimBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (el: HTMLElement) => {
          try {
            return decodeURIComponent(el.getAttribute("data-fm-src") ?? "");
          } catch {
            return el.getAttribute("data-fm-src") ?? "";
          }
        },
        renderHTML: (attrs: { source: string }) => ({
          "data-fm-src": encodeURIComponent(attrs.source),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-fm-src]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.source);
    const label = source.trimStart().startsWith("<!--") ? "HTML comment" : "HTML";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "fm-verbatim",
        contenteditable: "false",
        title: "Raw HTML is kept exactly as written; edit it in Source view.",
      }),
      ["span", { class: "fm-verbatim-label" }, label],
      ["pre", { class: "fm-verbatim-source" }, source],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { source: string } }) {
          state.write(node.attrs.source);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

// The editor-side form of a verbatim block: one HTML block markdown-it
// passes through and the node above parses.
export function verbatimTag(source: string): string {
  return `<div data-fm-src="${encodeURIComponent(source)}"></div>`;
}
