import { Node } from "@tiptap/core";

// An Obsidian wikilink the editor cannot follow: `[[note]]`,
// `[[note|label]]`, or an embed of something that is not an image. It
// shows its label, looks like a link, and is written back exactly as
// written: the serializer would otherwise escape the brackets, which
// breaks the link for Obsidian. Only image embeds become images
// (InlineImage); this is everything else.

export const WIKI_LINK = "wikiLink";

interface SerializerState {
  write(text: string): void;
}

export const WikiLink = Node.create({
  name: WIKI_LINK,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-fm-wiki") ?? "",
        renderHTML: (attrs: { raw: string }) => ({ "data-fm-wiki": attrs.raw }),
      },
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.textContent ?? "",
        rendered: false,
      },
    };
  },

  parseHTML() {
    // Ahead of HtmlMark's `span` rule.
    return [{ tag: "span[data-fm-wiki]", priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, class: "fm-wikilink" }, String(node.attrs.label)];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { raw: string } }) {
          state.write(node.attrs.raw);
        },
        parse: {},
      },
    };
  },
});
