import { Node } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";

// Math as GitHub renders it: `$x^2$` in text, `$$` on its own lines
// around a block, or a ```math fence. KaTeX draws it; the TeX rides on
// the node and is written back in the form it came in.
//
// src/format/markdownExtras.ts turns the dollar forms into
// `<span data-fm-math>` and `<div data-fm-math-block>`; the fence form
// is routed here by the fence renderer below.

interface SerializerState {
  write(text: string): void;
  closeBlock(node: unknown): void;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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

interface MarkdownIt {
  renderer: {
    rules: {
      fence?: ((...args: never[]) => string) & { fmMath?: boolean };
    };
  };
}

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ...srcAttribute("data-fm-math-block"),
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

  renderHTML({ node }) {
    const src = String(node.attrs.src);
    const attrs: Record<string, string> = { "data-fm-math-block": src };
    if (node.attrs.fence) attrs["data-fm-fence"] = "";
    return typeof document === "undefined" ? ["div", attrs] : render(src, true, attrs);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { src: string; fence: boolean } }) {
          state.write(
            node.attrs.fence
              ? `\`\`\`math\n${node.attrs.src}\n\`\`\``
              : `$$\n${node.attrs.src}\n$$`,
          );
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            const rules = markdownit.renderer.rules;
            if (rules.fence?.fmMath) return;
            const previous = rules.fence;
            const fence = (
              tokens: { info: string; content: string }[],
              idx: number,
              ...rest: never[]
            ): string => {
              const info = (tokens[idx].info || "").trim();
              const content = tokens[idx].content.replace(/\n$/, "");
              if (info === "math") {
                return `<div data-fm-math-block="${escapeAttr(content)}" data-fm-fence=""></div>\n`;
              }
              if (info === "mermaid") {
                return `<div data-fm-mermaid="${escapeAttr(content)}"></div>\n`;
              }
              return previous ? previous(tokens as never, idx as never, ...rest) : "";
            };
            fence.fmMath = true;
            rules.fence = fence as typeof rules.fence;
          },
        },
      },
    };
  },
});
