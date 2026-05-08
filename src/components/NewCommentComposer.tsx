import { useEffect, useRef, useState } from "react";
import { useAuthorName } from "../state/preferences";
import "./NewCommentComposer.css";

type Props = {
  // Where to anchor the composer in client-space pixels.
  x: number;
  y: number;
  // Plain-text preview of the current selection — shown muted so the
  // user can confirm they're commenting on the right span.
  selectionPreview: string;
  // Submit handler — called with the (non-empty) typed body.
  onSubmit: (body: string) => void;
  // Cancel handler — called on Esc or click outside.
  onCancel: () => void;
};

// New-comment composer. Floats beside the selection, max 360px wide.
// Phase 5 ships:
//   - Submit (⌘↵ / button) only when the textarea is non-empty.
//   - Cancel (Esc) at any time.
//
// The "Suggest edit" toggle and Reply / Edit composers live in later
// phases — this component is the new-comment-only variant.
export function NewCommentComposer({ x, y, selectionPreview, onSubmit, onCancel }: Props) {
  const [author] = useAuthorName();
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-focus the textarea on open. We do this once via mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-size: keep the textarea between 36 and 180 px tall as the user
  // types. We do this with a transient measure on every change.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(36, Math.min(180, ta.scrollHeight));
    ta.style.height = next + "px";
  }, [body]);

  const valid = body.trim().length > 0;

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!valid) return;
      onSubmit(body.trim());
    }
  };

  // Close when the user clicks outside the composer.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const c = containerRef.current;
      if (!c) return;
      if (e.target instanceof Node && c.contains(e.target)) return;
      onCancel();
    };
    // Listen on mousedown so the click that opens the composer doesn't
    // immediately also close it.
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onCancel]);

  return (
    <div
      ref={containerRef}
      className="fm-composer"
      data-testid="fm-composer"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="New comment"
    >
      <div className="fm-composer-header">
        <span className="fm-composer-author">{author}</span>
        <span className="fm-composer-author-muted">is commenting</span>
      </div>
      {selectionPreview && (
        <div className="fm-composer-selection" title={selectionPreview}>
          “{truncate(selectionPreview, 80)}”
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="fm-composer-textarea"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        data-testid="fm-composer-textarea"
      />
      <div className="fm-composer-footer">
        <span className="fm-composer-hint" aria-hidden>
          ⌘↵ to submit · Esc to cancel
        </span>
        <button
          type="button"
          className="fm-composer-submit"
          disabled={!valid}
          onClick={() => valid && onSubmit(body.trim())}
          data-testid="fm-composer-submit"
        >
          Comment
        </button>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
