import { Node } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import { blockAnchorAttribute, serializeBlockAnchored, writeLines } from "./BlockAnchor";

// Math as GitHub renders it: `$x^2$` in text, `$$` on its own lines
// around a block, or a ```math fence. KaTeX draws it; the TeX rides on
// the node and is written back in the form it came in.
//
// src/format/markdownExtras.ts turns the dollar forms into
// `<span data-fm-math>` and `<div data-fm-math-block>`, and a math
// fence into the latter with `data-fm-fence`.
//
// An inline equation is commented on like any other text, its TeX
// standing for it in the comment's anchor text. A block equation is
// anchored whole (see BlockAnchor.ts).

interface SerializerState {
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: unknown): void;
}

function render(tex: string, displayMode: boolean, attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(displayMode ? "div" : "span");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.className = displayMode ? "fm-math-block" : "fm-math";
  el.setAttribute("contenteditable", "false");
  el.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode });
  return el;
}

const srcAttribute = (attribute: string) => ({
  src: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute(attribute) ?? "",
    renderHTML: (attrs: { src: string }) => ({ [attribute]: attrs.src }),
  },
});

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return srcAttribute("data-fm-math");
  },

  parseHTML() {
    // Ahead of HtmlMark's `span` rule: the DOM parser tries mark rules
    // before node rules at equal priority.
    return [{ tag: "span[data-fm-math]", priority: 60 }];
  },

  renderHTML({ node }) {
    const src = String(node.attrs.src);
    return typeof document === "undefined"
      ? ["span", { "data-fm-math": src }]
      : render(src, false, { "data-fm-math": src });
  },

  renderText({ node }) {
    return `$${String(node.attrs.src)}$`;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { src: string } }) {
          state.write(`$${node.attrs.src}$`);
        },
        parse: {},
      },
    };
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ...srcAttribute("data-fm-math-block"),
      ...blockAnchorAttribute,
      // Written as a ```math fence rather than $$ lines.
      fence: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute("data-fm-fence"),
        renderHTML: (attrs: { fence: boolean }) => (attrs.fence ? { "data-fm-fence": "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-fm-math-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = String(node.attrs.src);
    const attrs = HTMLAttributes as Record<string, string>;
    return typeof document === "undefined" ? ["div", attrs] : render(src, true, attrs);
  },

  renderText({ node }) {
    return String(node.attrs.src);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: SerializerState,
          node: { attrs: { src: string; fence: boolean; anchorId: string | null } },
        ) {
          const [open, close] = node.attrs.fence ? ["```math", "```"] : ["$$", "$$"];
          serializeBlockAnchored(state, node, () =>
            writeLines(state, [open, ...node.attrs.src.split("\n"), close]),
          );
        },
        parse: {},
      },
    };
  },
});
