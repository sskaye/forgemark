import type { KeyboardEvent } from "react";
import { Modal } from "./Modal";
import { useState } from "react";
import "./PrintOptionsModal.css";

export type PrintOptions = {
  includeComments: boolean;
  includeSuggestions: boolean;
};

type Props = {
  onCancel: () => void;
  onContinue: (options: PrintOptions) => void;
};

export function PrintOptionsModal({ onCancel, onContinue }: Props) {
  const [includeComments, setIncludeComments] = useState(true);
  const [includeSuggestions, setIncludeSuggestions] = useState(true);
  // Enter inside the dialog continues; it used to fire from anywhere in
  // the window.
  const continueOnEnter = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onContinue({ includeComments, includeSuggestions });
    }
  };

  return (
    <Modal
      labelledBy="fm-print-title"
      testId="fm-print-options-modal"
      onClose={onCancel}
      width={380}
      onKeyDown={continueOnEnter}
    >
      <header className="fm-modal-header">
        <h2 id="fm-print-title" className="fm-modal-title">
          Print document
        </h2>
      </header>
      <section className="fm-modal-body fm-print-options-body">
        <label className="fm-print-option">
          <input
            type="checkbox"
            checked={includeComments}
            onChange={(e) => setIncludeComments(e.target.checked)}
            data-testid="fm-print-include-comments"
          />
          <span>Include comments</span>
        </label>
        <label className="fm-print-option">
          <input
            type="checkbox"
            checked={includeSuggestions}
            onChange={(e) => setIncludeSuggestions(e.target.checked)}
            data-testid="fm-print-include-suggestions"
          />
          <span>Include suggested edits</span>
        </label>
      </section>
      <footer className="fm-modal-footer">
        <button
          type="button"
          className="fm-modal-button"
          onClick={onCancel}
          data-testid="fm-print-cancel"
        >
          Cancel
        </button>
        <div className="fm-modal-spacer" />
        <button
          type="button"
          className="fm-modal-button fm-modal-button-primary"
          onClick={() => onContinue({ includeComments, includeSuggestions })}
          data-testid="fm-print-continue"
        >
          Continue…
        </button>
      </footer>
    </Modal>
  );
}
