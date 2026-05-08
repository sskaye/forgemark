import { useEffect, useState } from "react";
import type { Comment } from "../format/types";
import type { ReattachCandidate } from "../format/reattach";
import "./ReattachModal.css";

type Props = {
  comment: Comment;
  candidates: ReattachCandidate[];
  // Display the body so the user can read each candidate in context
  // (the modal doesn't render markdown — just shows the matched text
  // plus a few words on either side).
  body: string;
  onReattach: (candidate: ReattachCandidate) => void;
  onKeepFloating: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

// Phase 9 Reattach modal — the three-option recovery flow per design
// v1.1 §10. Selecting a candidate enables Reattach; Keep as floating
// and Discard are always available regardless of candidate count.
//
// Keyboard:
//   Esc → cancel
//   ↑/↓ → move candidate selection (when list is visible)
//   Enter → activate Reattach with current selection
export function ReattachModal({
  comment,
  candidates,
  body,
  onReattach,
  onKeepFloating,
  onDiscard,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<number>(candidates.length > 0 ? 0 : -1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (candidates.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(candidates.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        if (selected >= 0) onReattach(candidates[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [candidates, selected, onCancel, onReattach]);

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-reattach-title"
      data-testid="fm-reattach-modal"
      onClick={onCancel}
    >
      <div className="fm-modal" role="document" onClick={(e) => e.stopPropagation()}>
        <header className="fm-modal-header">
          <h2 id="fm-reattach-title" className="fm-modal-title">
            Reattach “{comment.anchor_text ?? "(no anchor text)"}”
          </h2>
          <p className="fm-modal-sub">
            {comment.author} · {trim(comment.body ?? "(no body)")}
          </p>
        </header>

        <section className="fm-modal-body">
          {candidates.length > 0 ? (
            <>
              <div className="fm-modal-section-label">Possible matches in the document</div>
              <ul
                className="fm-reattach-candidates"
                role="listbox"
                aria-label="Reattach candidates"
                data-testid="fm-reattach-candidates"
              >
                {candidates.map((c, i) => (
                  <li
                    key={`${c.from}-${c.to}-${c.rationale}`}
                    role="option"
                    aria-selected={selected === i}
                    className={"fm-reattach-candidate" + (selected === i ? " is-selected" : "")}
                    onClick={() => setSelected(i)}
                    onDoubleClick={() => onReattach(c)}
                    data-testid={`fm-reattach-candidate-${i}`}
                  >
                    <div className="fm-reattach-candidate-text">
                      <span className="fm-reattach-context">
                        {ellipsizeStart(body.slice(Math.max(0, c.from - 36), c.from))}
                      </span>
                      <mark className="fm-reattach-match">{c.text}</mark>
                      <span className="fm-reattach-context">
                        {ellipsizeEnd(body.slice(c.to, Math.min(body.length, c.to + 36)))}
                      </span>
                    </div>
                    <div className="fm-reattach-candidate-meta">
                      <span className="fm-reattach-rationale">
                        {labelForRationale(c.rationale)}
                      </span>
                      <span className="fm-reattach-score">{Math.round(c.score * 100)}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="fm-modal-empty" data-testid="fm-reattach-no-candidates">
              No matches found in the current document. You can keep this as a floating note or
              discard it.
            </div>
          )}
        </section>

        <footer className="fm-modal-footer">
          <button
            type="button"
            className="fm-modal-button fm-modal-button-danger"
            onClick={onDiscard}
            data-testid="fm-reattach-discard"
          >
            Discard comment
          </button>
          <div className="fm-modal-spacer" />
          <button
            type="button"
            className="fm-modal-button"
            onClick={onCancel}
            data-testid="fm-reattach-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="fm-modal-button"
            onClick={onKeepFloating}
            data-testid="fm-reattach-keep-floating"
          >
            Keep as floating note
          </button>
          <button
            type="button"
            className="fm-modal-button fm-modal-button-primary"
            disabled={selected < 0 || candidates.length === 0}
            onClick={() => selected >= 0 && onReattach(candidates[selected])}
            data-testid="fm-reattach-apply"
          >
            Reattach here
          </button>
        </footer>
      </div>
    </div>
  );
}

function trim(s: string, max = 100): string {
  const single = s.replace(/\s+/g, " ").trim();
  return single.length > max ? single.slice(0, max - 1) + "…" : single;
}

function ellipsizeStart(s: string): string {
  return s.length >= 36 ? "…" + s.slice(1) : s;
}

function ellipsizeEnd(s: string): string {
  return s.length >= 36 ? s.slice(0, -1) + "…" : s;
}

function labelForRationale(r: ReattachCandidate["rationale"]): string {
  switch (r) {
    case "exact":
      return "Exact text match";
    case "exact-with-context":
      return "Exact + context match";
    case "fuzzy":
      return "Approximate match";
  }
}
