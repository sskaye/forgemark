import { Mark } from "@tiptap/core";

// Inline HTML tags GitHub renders and the editor has no mark of its own
// for: <kbd>, <mark>, <abbr title>, <ins>, <small>, <cite>, <dfn>, <q>,
// <samp>, <var>, <tt>, and <span> with its attributes. One mark carries
// them all, with the tag name and attributes as its attrs, so the text
// inside stays editable, displays as the element, and comes back as the
// same tag when its block is rewritten. The editor used to keep the
// text and drop the tags.
//
// Attributes are kept as written for the file; event handlers are left
// out of the rendered element.

export const HTML_MARK = "htmlTag";

export const HTML_MARK_TAGS = [
  "abbr",
  "cite",
  "dfn",
  "ins",
  "kbd",
  "mark",
  "q",
  "samp",
  "small",
  "span",
  "tt",
  "var",
] as const;

type Attrs = Record<string, string>;

export function attributesOf(el: Element): Attrs {
  const attrs: Attrs = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  return attrs;
}

export function openTag(tag: string, attrs: Attrs): string {
  const parts = Object.entries(attrs).map(([name, value]) =>
    value === "" ? ` ${name}` : ` ${name}="${value.replace(/"/g, "&quot;")}"`,
  );
  return `<${tag}${parts.join("")}>`;
}

const isHandler = (name: string) => /^on/i.test(name);

export const HtmlMark = Mark.create({
  name: HTML_MARK,
  // Two of these may nest (<kbd><small>…</small></kbd>); a mark
  // normally excludes its own type.
  excludes: "",

  addAttributes() {
    return {
      tag: { default: "span", rendered: false },
      attrs: { default: {}, rendered: false },
    };
  },

  parseHTML() {
    return HTML_MARK_TAGS.map((tag) => ({
      tag,
      getAttrs: (el: HTMLElement) => {
        // The editor's own spans (anchor highlights, search matches)
        // are not the document's.
        if (tag === "span" && (el.hasAttribute("data-anchor-id") || /(^|\s)fm-/.test(el.className)))
          return false;
        return { tag, attrs: attributesOf(el) };
      },
    }));
  },

  renderHTML({ mark }) {
    const attrs = mark.attrs.attrs as Attrs;
    const safe: Attrs = {};
    for (const [name, value] of Object.entries(attrs)) if (!isHandler(name)) safe[name] = value;
    return [String(mark.attrs.tag), safe, 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { tag: string; attrs: Attrs } }) =>
            openTag(mark.attrs.tag, mark.attrs.attrs),
          close: (_state: unknown, mark: { attrs: { tag: string } }) => `</${mark.attrs.tag}>`,
          mixable: true,
          expelEnclosingWhitespace: false,
        },
        parse: {},
      },
    };
  },
});
