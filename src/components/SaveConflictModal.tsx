import { useEffect, useMemo } from "react";
import type { DocumentState } from "../state/document";
import "./ConflictModals.css";

type Props = {
  state: DocumentState;
  onCancel: () => void;
  onOverwrite: () => void;
};

// Phase 10 save-conflict modal (design v1.1 §11c). Pops up when ⌘S is
// pressed while an externalChange is pending. Per v1.1 feedback §1, §2:
// only **two** buttons (Cancel + Overwrite disk version) and no full
// diff drawer — just two compact diff signals.
//
// Cancel keeps the conflict pending and dirty; the banner remains and a
// subsequent ⌘S re-opens this modal.
export function SaveConflictModal({ state, onCancel, onOverwrite }: Props) {
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

  const signals = useMemo(() => computeDiffSignals(state), [state]);

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-save-conflict-title"
      data-testid="fm-save-conflict-modal"
      onClick={onCancel}
    >
      <div className="fm-modal" role="document" onClick={(e) => e.stopPropagation()}>
        <header className="fm-modal-header">
          <h2 id="fm-save-conflict-title" className="fm-modal-title">
            File changed on disk while you edited
          </h2>
          <p className="fm-modal-sub">
            Saving now will replace the disk version with yours. Disk differences from your version:
          </p>
        </header>
        <section className="fm-modal-body">
          <ul className="fm-conflict-signals" data-testid="fm-save-conflict-signals">
            {signals.unknown ? (
              <li className="fm-conflict-signal-unknown">
                Unknown changes — disk content couldn’t be parsed.
              </li>
            ) : (
              <>
                <li>
                  <strong>Comments:</strong>{" "}
                  {describeCommentSignal(signals.commentsAdded, signals.commentsRemoved)}
                </li>
                <li>
                  <strong>Body bytes:</strong> {signals.bodyChanged ? "changed" : "unchanged"}
                </li>
              </>
            )}
          </ul>
        </section>
        <footer className="fm-modal-footer">
          <button
            type="button"
            className="fm-modal-button"
            onClick={onCancel}
            data-testid="fm-save-conflict-cancel"
          >
            Cancel
          </button>
          <div className="fm-modal-spacer" />
          <button
            type="button"
            className="fm-modal-button fm-modal-button-danger"
            onClick={onOverwrite}
            data-testid="fm-save-conflict-overwrite"
          >
            Overwrite disk version
          </button>
        </footer>
      </div>
    </div>
  );
}

type DiffSignals = {
  unknown: boolean;
  commentsAdded: number;
  commentsRemoved: number;
  bodyChanged: boolean;
};

function computeDiffSignals(state: DocumentState): DiffSignals {
  const ec = state.externalChange;
  if (!ec || ec.parseError) {
    return {
      unknown: true,
      commentsAdded: 0,
      commentsRemoved: 0,
      bodyChanged: false,
    };
  }
  // Compare in-memory comments vs disk comments by id.
  const ours = new Set(state.comments.map((c) => c.id));
  const theirs = new Set(ec.comments.map((c) => c.id));
  let added = 0;
  let removed = 0;
  for (const id of theirs) if (!ours.has(id)) added++;
  for (const id of ours) if (!theirs.has(id)) removed++;
  return {
    unknown: false,
    commentsAdded: added,
    commentsRemoved: removed,
    bodyChanged: state.body !== ec.body,
  };
}

function describeCommentSignal(added: number, removed: number): string {
  if (added === 0 && removed === 0) return "no change";
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added on disk`);
  if (removed > 0) parts.push(`${removed} removed on disk`);
  return parts.join(", ");
}
