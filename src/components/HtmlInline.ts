import { Node } from "@tiptap/core";
import { HTML_MARK_TAGS } from "./HtmlMark";

// Inline HTML the editor cannot hold as a mark or a node: a comment
// (`<!-- note -->`), a void tag (`<wbr>`), or a tag GitHub does not
// render (`<video>`, `<font>`). Each arrives as its own atom carrying
// its source, shows nothing, and is written back byte for byte. The
// text between an unknown open and close tag stays ordinary text, so it
// is still editable and commentable. The editor used to drop all of it.
//
// The markdown-it renderer emits `<fm-html data-src="…">` for these
// (`renderInlineHtml`); everything else inline HTML is left for the DOM
// parser and the mark or node that understands it.

export const HTML_INLINE = "htmlInline";

interface SerializerState {
  write(text: string): void;
}

// Tags the editor turns into something of its own.
const UNDERSTOOD = new Set<string>([
  ...HTML_MARK_TAGS,
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "strike",
  "sub",
  "sup",
  "code",
  "br",
  "img",
  "fm-anchor",
]);

export function htmlInlineTag(source: string): string {
  return `<fm-html data-src="${encodeURIComponent(source)}"></fm-html>`;
}

// What the editor should be handed for one inline HTML token.
export function renderInlineHtml(source: string): string {
  const tag = /^<\/?([a-zA-Z][\w-]*)/.exec(source);
  return tag && UNDERSTOOD.has(tag[1].toLowerCase()) ? source : htmlInlineTag(source);
}

interface MarkdownIt {
  renderer: {
    rules: {
      html_inline?: (tokens: { content: string }[], idx: number) => string;
    };
  };
}

export const HtmlInline = Node.create({
  name: HTML_INLINE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (el: HTMLElement) => {
          try {
            return decodeURIComponent(el.getAttribute("data-src") ?? "");
          } catch {
            return el.getAttribute("data-src") ?? "";
          }
        },
        renderHTML: (attrs: { source: string }) => ({
          "data-src": encodeURIComponent(attrs.source),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "fm-html[data-src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["fm-html", { ...HTMLAttributes, class: "fm-html-inline" }];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { source: string } }) {
          state.write(node.attrs.source);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.renderer.rules.html_inline = (tokens, idx) =>
              renderInlineHtml(tokens[idx].content);
          },
        },
      },
    };
  },
});
