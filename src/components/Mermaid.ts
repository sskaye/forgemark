import { Node } from "@tiptap/core";

// A ```mermaid fence, drawn as the diagram GitHub would show. The
// source rides on the node and is written back as the fence. Mermaid
// itself is loaded the first time a diagram is shown, since it is the
// largest thing in the bundle and most documents have none; until it
// arrives, and if it fails, the block shows the source.

interface SerializerState {
  write(text: string): void;
  closeBlock(node: unknown): void;
}

let counter = 0;
type Renderer = (source: string, dark: boolean) => Promise<string>;

let renderer: Renderer = async (source, dark) => {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });
  const { svg } = await mermaid.render(`fm-mermaid-${++counter}`, source);
  return svg;
};

// Tests swap the renderer so they need neither the library nor an SVG
// engine.
export function setMermaidRenderer(next: Renderer | null): void {
  renderer = next ?? renderer;
}

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-fm-mermaid") ?? "",
        renderHTML: (attrs: { src: string }) => ({ "data-fm-mermaid": attrs.src }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-fm-mermaid]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      { ...HTMLAttributes, class: "fm-mermaid" },
      ["pre", { class: "fm-mermaid-source" }, String(node.attrs.src)],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "fm-mermaid";
      dom.setAttribute("contenteditable", "false");
      const source = document.createElement("pre");
      source.className = "fm-mermaid-source";
      let shown = "";
      const draw = (src: string) => {
        shown = src;
        source.textContent = src;
        dom.replaceChildren(source);
        if (import.meta.env?.MODE === "test") return;
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        renderer(src, dark)
          .then((svg) => {
            if (shown !== src) return;
            dom.innerHTML = svg;
          })
          .catch((err: unknown) => {
            if (shown !== src) return;
            const note = document.createElement("div");
            note.className = "fm-mermaid-error";
            note.textContent = `Diagram could not be drawn: ${err instanceof Error ? err.message : String(err)}`;
            dom.append(note);
          });
      };
      draw(String(node.attrs.src));
      return {
        dom,
        update: (next) => {
          if (next.type !== node.type) return false;
          if (String(next.attrs.src) !== shown) draw(String(next.attrs.src));
          return true;
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { src: string } }) {
          state.write(`\`\`\`mermaid\n${node.attrs.src}\n\`\`\``);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
