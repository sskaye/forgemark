import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";

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
// node (an inline anchor lives on AnchorEdge nodes). This extension:
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
//
// The block is highlighted by lowlight for the languages highlight.js
// calls common, as GitHub highlights it. A block with no language, or
// one lowlight does not know, is left plain: the extension would guess
// a language for it, and a guess colours prose and shell transcripts in
// ways that mislead.

const lowlight = createLowlight(common);
const quietLowlight = {
  highlight: lowlight.highlight.bind(lowlight),
  highlightAuto: () => ({ type: "root", children: [] }),
  listLanguages: lowlight.listLanguages.bind(lowlight),
  registered: lowlight.registered.bind(lowlight),
};

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
          // markdown-it hands the block its content with a trailing
          // newline. Writing it and then ensuring another produced a
          // blank line before the closing fence, which inside a list
          // item grew by one on every save.
          const text = node.textContent.replace(/\n$/, "");
          // A fence must be longer than any backtick run inside it, or a
          // block that quotes a fence is cut short at the quoted one.
          const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
          const fence = "`".repeat(Math.max(3, longest + 1));
          if (id != null) state.write(`<!-- fmc:${id} -->\n`);
          state.write(fence + (node.attrs.language || "") + "\n");
          state.text(text, false);
          state.ensureNewLine();
          state.write(fence);
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
}).configure({ lowlight: quietLowlight });
