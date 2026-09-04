import { Table } from "@tiptap/extension-table";
import type { Node as PMNode } from "@tiptap/pm/model";

// tiptap-markdown's table serializer, with one change: a `|` inside a
// cell is written as `\|`, in prose and in inline code alike, as GFM
// requires. Without it a cell containing a pipe split into two on the
// first edit of the table.

interface SerializerState {
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: unknown): void;
  renderInline(node: PMNode): void;
  text(text: string, escape?: boolean): void;
  esc(text: string, startOfLine?: boolean): string;
  inTable: boolean;
}

export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const text = state.text;
          state.inTable = true;
          state.text = (s: string, escape = true) =>
            text.call(state, (escape ? state.esc(s, false) : s).replace(/\|/g, "\\|"), false);
          try {
            node.forEach((row, _p, i) => {
              state.write("| ");
              row.forEach((cell, _p2, j) => {
                if (j) state.write(" | ");
                const content = cell.firstChild;
                if (content && content.textContent.trim()) state.renderInline(content);
              });
              state.write(" |");
              state.ensureNewLine();
              if (!i) {
                const delimiters = Array.from({ length: row.childCount }, () => "---").join(" | ");
                state.write(`| ${delimiters} |`);
                state.ensureNewLine();
              }
            });
          } finally {
            state.text = text;
            state.inTable = false;
          }
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
