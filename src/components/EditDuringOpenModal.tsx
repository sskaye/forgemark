import { useEffect } from "react";
import type { DocumentState } from "../state/document";
import "./ConflictModals.css";

type Props = {
  state: DocumentState;
  onReloadFromDisk: () => void;
  onKeepYours: () => void;
  onCancel: () => void;
};

// Phase 10 edit-during-open modal (design v1.1 §11b). Pops up when an
// external change arrives while the user has unsaved work. Per v1.1
// feedback §3 there is **no** "Show details" disclosure — the summary
// is immediate.
//
// Cancel keeps the externalChange pending; the banner remains visible
// and a subsequent ⌘S routes through the save-conflict modal.
export function EditDuringOpenModal({ state, onReloadFromDisk, onKeepYours, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const items = summarizeUnsavedWork(state);

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-edit-during-title"
      data-testid="fm-edit-during-modal"
      onClick={onCancel}
    >
      <div className="fm-modal" role="document" onClick={(e) => e.stopPropagation()}>
        <header className="fm-modal-header">
          <h2 id="fm-edit-during-title" className="fm-modal-title">
            This file changed on disk
          </h2>
          <p className="fm-modal-sub">You have unsaved work in this window:</p>
        </header>
        <section className="fm-modal-body">
          <ul className="fm-conflict-summary" data-testid="fm-edit-during-summary">
            {items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </section>
        <footer className="fm-modal-footer">
          <button
            type="button"
            className="fm-modal-button"
            onClick={onCancel}
            data-testid="fm-edit-during-cancel"
          >
            Cancel
          </button>
          <div className="fm-modal-spacer" />
          <button
            type="button"
            className="fm-modal-button"
            onClick={onKeepYours}
            data-testid="fm-edit-during-keep"
          >
            Keep your version
          </button>
          <button
            type="button"
            className="fm-modal-button fm-modal-button-primary"
            onClick={onReloadFromDisk}
            data-testid="fm-edit-during-reload"
          >
            Reload from disk
          </button>
        </footer>
      </div>
    </div>
  );
}

// Build the unsaved-work summary line. Keeps the items short — three
// concise phrases are easier to scan than one long sentence.
function summarizeUnsavedWork(state: DocumentState): string[] {
  const items: string[] = [];
  if (state.composer != null) {
    items.push(composerLabel(state.composer.mode));
  }
  if (state.dirty) {
    items.push("Unsaved edits to comments and/or body.");
  }
  if (items.length === 0) {
    items.push("Unsaved changes in this window.");
  }
  return items;
}

function composerLabel(mode: string): string {
  switch (mode) {
    case "new":
      return "1 open new-comment composer.";
    case "reply":
      return "1 unsent reply.";
    case "editComment":
      return "1 comment being edited.";
    case "editReply":
      return "1 reply being edited.";
    default:
      return "1 open composer.";
  }
}
