import { Node } from "@tiptap/core";

// Footnotes as GitHub renders them: `[^label]` in text is a small
// superscript reference; `[^label]: text` is its definition, shown
// where it is written with the label in the margin. Both write back as
// the source form, so an edit near either keeps it. The editor used to
// show both as literal text and escape the brackets on an edit.

interface SerializerState {
  write(text: string): void;
  renderInline(node: unknown): void;
  closeBlock(node: unknown): void;
}

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-fm-footnote") ?? "1",
        renderHTML: (attrs: { label: string }) => ({ "data-fm-footnote": attrs.label }),
      },
    };
  },

  parseHTML() {
    // Ahead of the superscript mark: the DOM parser tries mark rules
    // before node rules at equal priority, and its `sup` rule would
    // take the element first.
    return [{ tag: "sup[data-fm-footnote]", priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "sup",
      { ...HTMLAttributes, class: "fm-footnote-ref" },
      `[${String(node.attrs.label)}]`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { label: string } }) {
          state.write(`[^${node.attrs.label}]`);
        },
        parse: {},
      },
    };
  },
});

export const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-fm-footnote-def") ?? "1",
        renderHTML: (attrs: { label: string }) => ({ "data-fm-footnote-def": attrs.label }),
      },
    };
  },

  parseHTML() {
    // markdown-it's output holds the text directly; the editor's own
    // rendering wraps it so the label can sit beside it.
    return [
      {
        tag: "div[data-fm-footnote-def]",
        contentElement: (el: HTMLElement) =>
          el.querySelector<HTMLElement>(".fm-footnote-body") ?? el,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      { ...HTMLAttributes, class: "fm-footnote-def" },
      ["span", { class: "fm-footnote-label", contenteditable: "false" }, String(node.attrs.label)],
      ["div", { class: "fm-footnote-body" }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { label: string } }) {
          state.write(`[^${node.attrs.label}]: `);
          state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
