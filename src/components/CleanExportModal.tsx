import type { KeyboardEvent } from "react";
import { Modal } from "./Modal";

type Props = {
  commentCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

// Phase 11 Clean Export confirmation (design v1.1 §10). Compact modal
// with a single primary action. The actual file write happens in the
// caller — this component is purely the confirmation surface.
export function CleanExportModal({ commentCount, onCancel, onConfirm }: Props) {
  // Enter inside the dialog confirms; Enter elsewhere is not an answer.
  const confirmOnEnter = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      onConfirm();
    }
  };
  return (
    <Modal
      labelledBy="fm-clean-export-title"
      testId="fm-clean-export-modal"
      onClose={onCancel}
      width={360}
      onKeyDown={confirmOnEnter}
    >
      <header className="fm-modal-header">
        <h2 id="fm-clean-export-title" className="fm-modal-title">
          Export a clean copy?
        </h2>
      </header>
      <section className="fm-modal-body">
        <p style={{ margin: 0, fontSize: 13, color: "var(--fm-prose-ink)" }}>
          This saves a new file with{" "}
          {commentCount === 1 ? "the comment" : `all ${commentCount} comments`} and anchor markers
          stripped. The current file is unchanged.
        </p>
      </section>
      <footer className="fm-modal-footer">
        <button
          type="button"
          className="fm-modal-button"
          onClick={onCancel}
          data-testid="fm-clean-export-cancel"
        >
          Cancel
        </button>
        <div className="fm-modal-spacer" />
        <button
          type="button"
          className="fm-modal-button fm-modal-button-primary"
          onClick={onConfirm}
          data-testid="fm-clean-export-confirm"
        >
          Choose location…
        </button>
      </footer>
    </Modal>
  );
}
