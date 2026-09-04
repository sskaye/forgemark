import Blockquote from "@tiptap/extension-blockquote";
import { ALERT_KINDS, type AlertKind } from "../format/markdownExtras";

// A blockquote that may be a callout: `> [!NOTE]` on the first line
// makes the quote a note, and the same for TIP, IMPORTANT, WARNING, and
// CAUTION, which GitHub styles. Obsidian allows any type
// (`[!Takeaway]`) and a fold marker after the bracket (`[!Summary]-`);
// those render with a neutral rail and their own text as the label.
// The type and marker ride on the node as written and are written back
// as that first line, so an edit inside the callout keeps it one.

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

// The kind the stylesheet knows, or "generic" for any other type.
export function alertStyleKey(type: string): AlertKind | "generic" {
  const key = type.trim().toLowerCase();
  return (ALERT_KINDS as readonly string[]).includes(key) ? (key as AlertKind) : "generic";
}

export const AlertBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      // The type as written: "NOTE", "Takeaway", "Executive Summary".
      alert: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-alert-type") ?? el.getAttribute("data-alert"),
        renderHTML: (attrs: { alert: string | null }) => {
          if (!attrs.alert) return {};
          const key = alertStyleKey(attrs.alert);
          return {
            "data-alert": key,
            "data-alert-type": attrs.alert,
            "data-alert-label": key === "generic" ? attrs.alert.trim() : LABELS[key],
          };
        },
      },
      // Obsidian's fold marker after the bracket: "+" open, "-" folded.
      fold: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-alert-fold"),
        renderHTML: (attrs: { fold: string | null }) =>
          attrs.fold ? { "data-alert-fold": attrs.fold } : {},
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: SerializerState,
          node: { attrs: { alert: string | null; fold: string | null } },
        ) {
          state.wrapBlock("> ", null, node, () => {
            if (node.attrs.alert) {
              state.write(`[!${node.attrs.alert}]${node.attrs.fold ?? ""}`);
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
