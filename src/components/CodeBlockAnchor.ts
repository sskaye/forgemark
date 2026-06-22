import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

// CodeBlock with whole-block comment anchoring. The file format can't
// place markers *inside* a fenced block (they'd be read as code), so a
// comment on a code block is stored with the marker pair on its own lines
// *around* the fence:
//
//   <!-- fmc:N -->
//   ```lang
//   code…
//   ```
//   <!-- /fmc:N -->
//
// To survive the markdown ⇄ editor round-trip, the anchor must live on the
// node (like the inline AnchorMark lives on a mark). This extension:
//   - adds an `anchorId` attribute, rendered as `data-anchor-id` on <pre>
//     so the existing click / hover / focus wiring (which keys off
//     `[data-anchor-id]`) lights the block up like an inline anchor;
//   - serializes an anchored block back to the comment-marker form above;
//   - on parse, reads `fmc=N` out of the fence info string (the display
//     pre-processor `blockAnchorsToInfoString` puts it there) and strips it
//     from the language.
//
// The marker⇄info-string conversion on the display side keeps the stored
// markdown clean (plain comment markers), while the editor still gets the
// anchor as a real node attribute.

interface MarkdownToken {
  info: string;
}

interface MarkdownRenderer {
  renderToken(tokens: MarkdownToken[], idx: number, options: unknown): string;
  rules: {
    fence?: (
      tokens: MarkdownToken[],
      idx: number,
      options: unknown,
      env: unknown,
      self: MarkdownRenderer,
    ) => string;
  };
}

interface MarkdownIt {
  renderer: MarkdownRenderer;
}

interface SerializerState {
  write(text: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: unknown): void;
}

interface CodeBlockNode {
  attrs: { language: string | null; anchorId: string | null };
  textContent: string;
}

const FMC_INFO_RE = /(?:^|\s)fmc=(\d+)(?:\s|$)/;
const defaultLowlight = createLowlight(common);

export const CodeBlockAnchor = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      anchorId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-anchor-id"),
        renderHTML: (attrs: { anchorId: string | null }) =>
          attrs.anchorId == null ? {} : { "data-anchor-id": String(attrs.anchorId) },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: CodeBlockNode) {
          const id = node.attrs.anchorId;
          if (id != null) state.write(`<!-- fmc:${id} -->\n`);
          state.write("```" + (node.attrs.language || "") + "\n");
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write("```");
          if (id != null) {
            state.ensureNewLine();
            state.write(`<!-- /fmc:${id} -->`);
          }
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            const previous = markdownit.renderer.rules.fence;
            markdownit.renderer.rules.fence = (tokens, idx, options, env, self) => {
              const token = tokens[idx];
              const match = FMC_INFO_RE.exec(token.info || "");
              if (match) {
                // Strip the fmc marker from the info so it doesn't leak
                // into the language class.
                token.info = (token.info || "").replace(/(?:^|\s)fmc=\d+/, "").trim();
              }
              const html = previous
                ? previous(tokens, idx, options, env, self)
                : self.renderToken(tokens, idx, options);
              return match ? html.replace(/^<pre/, `<pre data-anchor-id="${match[1]}"`) : html;
            };
          },
        },
      },
    };
  },
}).configure({ lowlight: defaultLowlight });
