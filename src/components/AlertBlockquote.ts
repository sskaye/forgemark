import Blockquote from "@tiptap/extension-blockquote";
import { ALERT_KINDS, type AlertKind } from "../format/markdownExtras";

// A blockquote that may be a GitHub alert: `> [!NOTE]` on the first
// line makes the quote a note, and the same for TIP, IMPORTANT,
// WARNING, and CAUTION. The kind rides on the node and is written back
// as that first line, so an edit inside the alert keeps it one.

interface SerializerState {
  write(text: string): void;
  ensureNewLine(): void;
  wrapBlock(delim: string, firstDelim: string | null, node: unknown, f: () => void): void;
  renderContent(node: unknown): void;
}

const LABELS: Record<AlertKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

export const AlertBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      alert: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const kind = el.getAttribute("data-alert");
          return kind && (ALERT_KINDS as readonly string[]).includes(kind) ? kind : null;
        },
        renderHTML: (attrs: { alert: AlertKind | null }) =>
          attrs.alert ? { "data-alert": attrs.alert, "data-alert-label": LABELS[attrs.alert] } : {},
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { alert: AlertKind | null } }) {
          state.wrapBlock("> ", null, node, () => {
            if (node.attrs.alert) {
              state.write(`[!${node.attrs.alert.toUpperCase()}]`);
              state.ensureNewLine();
            }
            state.renderContent(node);
          });
        },
        parse: {},
      },
    };
  },
});
