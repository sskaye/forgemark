import Image from "@tiptap/extension-image";

// Images are inline, as on GitHub: `[![badge](x.svg)](https://…)` keeps
// its link, and an `<img>` in a sentence stays in the sentence. A
// width or height (the usual way to size an image on GitHub, where
// Markdown has no syntax for it) is kept and written back as the tag;
// an image without either is written as `![alt](src "title")`. An
// Obsidian embed (`![[file.png|alt]]`) remembers that it was one and is
// written back the same way, target as written.

interface SerializerState {
  write(text: string): void;
  esc(text: string, startOfLine?: boolean): string;
}

interface ImageNode {
  attrs: {
    src: string;
    alt: string | null;
    title: string | null;
    width: number | string | null;
    height: number | string | null;
    wikilink: boolean;
    wikitarget: string | null;
  };
}

export const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wikilink: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-wikilink") === "true",
        renderHTML: (attrs: { wikilink: boolean }) =>
          attrs.wikilink ? { "data-wikilink": "true" } : {},
      },
      wikitarget: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-wikitarget"),
        renderHTML: (attrs: { wikitarget: string | null }) =>
          attrs.wikitarget ? { "data-wikitarget": attrs.wikitarget } : {},
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: ImageNode) {
          const { src, alt, title, width, height, wikilink, wikitarget } = node.attrs;
          if (wikilink) {
            const target = wikitarget ?? src;
            state.write(alt ? `![[${target}|${alt}]]` : `![[${target}]]`);
            return;
          }
          if (width != null || height != null) {
            const attr = (name: string, value: string | number | null) =>
              value == null || value === ""
                ? ""
                : ` ${name}="${String(value).replace(/"/g, "&quot;")}"`;
            state.write(
              `<img${attr("src", src)}${attr("alt", alt)}${attr("title", title)}${attr("width", width)}${attr("height", height)}>`,
            );
            return;
          }
          const quotedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
          state.write(`![${state.esc(alt ?? "")}](${src.replace(/[()]/g, "\\$&")}${quotedTitle})`);
        },
        parse: {},
      },
    };
  },
}).configure({ inline: true, allowBase64: true });
