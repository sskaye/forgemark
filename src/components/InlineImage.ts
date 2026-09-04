import Image from "@tiptap/extension-image";

// Images are inline, as on GitHub: `[![badge](x.svg)](https://…)` keeps
// its link, and an `<img>` in a sentence stays in the sentence. A
// width or height (the usual way to size an image on GitHub, where
// Markdown has no syntax for it) is kept and written back as the tag;
// an image without either is written as `![alt](src "title")`.

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
  };
}

export const InlineImage = Image.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: ImageNode) {
          const { src, alt, title, width, height } = node.attrs;
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
