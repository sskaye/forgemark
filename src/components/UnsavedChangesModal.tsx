import { useEffect } from "react";
import "./ConflictModals.css";

type Props = {
  fileName: string;
  // True when the buffer has never been written to disk, so "Save"
  // means "pick a location first".
  untitled: boolean;
  // True when the file changed on disk underneath us. Saving would
  // clobber that change, so we don't offer it here — the conflict
  // surfaces are where that decision belongs.
  conflictPending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

// Shown when an action would throw away unsaved work that auto-save
// can't quietly write for us: an Untitled buffer with no destination
// yet, or a document whose disk copy has changed underneath us.
//
// Everything auto-save *can* handle is saved silently instead of
// surfacing this — see `guardDiscard` in DocumentBindings.
export function UnsavedChangesModal({
  fileName,
  untitled,
  conflictPending,
  onSave,
  onDiscard,
  onCancel,
}: Props) {
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

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-unsaved-title"
      data-testid="fm-unsaved-modal"
      onClick={onCancel}
    >
      <div className="fm-modal" role="document" onClick={(e) => e.stopPropagation()}>
        <header className="fm-modal-header">
          <h2 id="fm-unsaved-title" className="fm-modal-title">
            Save changes to {fileName}?
          </h2>
          <p className="fm-modal-sub">
            {conflictPending
              ? "This file also changed on disk, so it can’t be saved automatically. If you don’t save, your changes are lost."
              : "This document has never been saved. If you don’t save it, your changes are lost."}
          </p>
        </header>
        <footer className="fm-modal-footer">
          <button
            type="button"
            className="fm-modal-button"
            onClick={onCancel}
            data-testid="fm-unsaved-cancel"
          >
            Cancel
          </button>
          <div className="fm-modal-spacer" />
          <button
            type="button"
            className="fm-modal-button fm-modal-button-danger"
            onClick={onDiscard}
            data-testid="fm-unsaved-discard"
          >
            Don’t Save
          </button>
          {!conflictPending && (
            <button
              type="button"
              className="fm-modal-button fm-modal-button-primary"
              onClick={onSave}
              data-testid="fm-unsaved-save"
              autoFocus
            >
              {untitled ? "Save As…" : "Save"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
