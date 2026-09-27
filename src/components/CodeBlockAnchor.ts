import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { blockAnchorAttribute, serializeBlockAnchored } from "./BlockAnchor";

// CodeBlock with whole-block comment anchoring (see BlockAnchor.ts).
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

export const CodeBlockAnchor = CodeBlockLowlight.extend({
  addAttributes() {
    return { ...this.parent?.(), ...blockAnchorAttribute };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: CodeBlockNode) {
          // markdown-it hands the block its content with a trailing
          // newline. Writing it and then ensuring another produced a
          // blank line before the closing fence, which inside a list
          // item grew by one on every save.
          const text = node.textContent.replace(/\n$/, "");
          // A fence must be longer than any backtick run inside it, or a
          // block that quotes a fence is cut short at the quoted one.
          const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
          const fence = "`".repeat(Math.max(3, longest + 1));
          serializeBlockAnchored(state, node, () => {
            state.write(fence + (node.attrs.language || "") + "\n");
            state.text(text, false);
            state.ensureNewLine();
            state.write(fence);
          });
        },
        // markdownExtras reads the anchor id off the fence.
        parse: {},
      },
    };
  },
}).configure({ lowlight: quietLowlight });
