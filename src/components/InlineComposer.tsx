import { useEffect, useRef, useState } from "react";
import "./InlineComposer.css";

type Props = {
  // Pre-fill the textarea (used for edit composers).
  initialBody?: string;
  // Submit button label. Reply / Save / Suggest, etc.
  submitLabel?: string;
  // Optional placeholder text.
  placeholder?: string;
  // Called when the user submits a non-empty body. Trimmed of leading /
  // trailing whitespace.
  onSubmit: (body: string) => void;
  // Called on Esc, click-outside, or Cancel button click.
  onCancel: () => void;
  // Author chip text in the header. e.g. "Maya is replying" / "Editing
  // your reply".
  headerLabel?: string;
};

// A small inline composer used for replies and edits. Renders inside an
// FMCard rather than floating beside the editor (that's the new-comment
// composer's job). Same submit semantics as the new-comment composer:
//
//   - ⌘↵ submits if non-empty
//   - Esc cancels
//   - Click-outside cancels
//   - Submit button enabled when textarea has non-whitespace content
export function InlineComposer({
  initialBody = "",
  submitLabel = "Post",
  placeholder = "Add a comment…",
  headerLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    // Position cursor at end when editing pre-filled content.
    const ta = textareaRef.current;
    if (ta && initialBody.length > 0) {
      ta.setSelectionRange(initialBody.length, initialBody.length);
    }
  }, [initialBody]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(36, Math.min(180, ta.scrollHeight));
    ta.style.height = next + "px";
  }, [body]);

  // Click-outside cancels. Listening on mousedown so the click that
  // opens the composer doesn't immediately close it.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const c = containerRef.current;
      if (!c) return;
      if (e.target instanceof Node && c.contains(e.target)) return;
      onCancel();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onCancel]);

  const valid = body.trim().length > 0;
  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    e.stopPropagation();
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

  return (
    <div
      ref={containerRef}
      className="fm-inline-composer"
      data-testid="fm-inline-composer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {headerLabel && <div className="fm-inline-composer-header">{headerLabel}</div>}
      <textarea
        ref={textareaRef}
        className="fm-inline-composer-textarea"
        placeholder={placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        data-testid="fm-inline-composer-textarea"
      />
      <div className="fm-inline-composer-footer">
        <span className="fm-inline-composer-hint" aria-hidden>
          ⌘↵ to submit · Esc to cancel
        </span>
        <button type="button" className="fm-inline-composer-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="fm-inline-composer-submit"
          disabled={!valid}
          onClick={() => valid && onSubmit(body.trim())}
          data-testid="fm-inline-composer-submit"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
