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
  // Submit handler for plain comments. Called with the (non-empty)
  // typed body.
  onSubmitComment: (body: string) => void;
  // Submit handler for suggested edits. Called with the proposed
  // replacement and an (optional) accompanying body.
  onSubmitSuggestion: (replacement: string, body: string) => void;
  // Cancel handler — Esc or click-outside.
  onCancel: () => void;
  // Initial mode. Defaults to "comment". The right-click context
  // menu's "Suggest edit" path opens the composer in "suggest"
  // mode directly.
  initialMode?: "comment" | "suggest";
};

// New-comment composer (Phase 5 + Phase 7).
//
// Two submit paths share one component, switched by the "Suggest edit"
// toggle:
//
//   - Comment mode (default): a single textarea. Submit (⌘↵) when
//     non-empty. Body required by the schema.
//
//   - Suggest mode: stacked Original (read-only, populated from the
//     selection) and Replacement (editable, autosize). Submit "Suggest"
//     when the replacement has content. The body textarea stays
//     available — typing into it adds an explanatory comment, but it's
//     optional (the suggestion can stand alone per the schema).
export function NewCommentComposer({
  x,
  y,
  selectionPreview,
  onSubmitComment,
  onSubmitSuggestion,
  onCancel,
  initialMode = "comment",
}: Props) {
  const [author] = useAuthorName();
  const [body, setBody] = useState("");
  const [replacement, setReplacement] = useState("");
  const [suggesting, setSuggesting] = useState(initialMode === "suggest");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const replacementRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (suggesting) replacementRef.current?.focus();
    else bodyRef.current?.focus();
  }, [suggesting]);

  useEffect(() => {
    autosize(bodyRef.current);
  }, [body]);
  useEffect(() => {
    autosize(replacementRef.current);
  }, [replacement]);

  // Keep the panel fully on-screen. It's `position: fixed` anchored just
  // below the selection (EditorPane sets x/y), so a selection near the
  // bottom of the viewport would push the footer — Save/Cancel — off
  // screen and out of reach. After mount (and whenever the panel resizes
  // via the Suggest toggle or textarea autosize) we measure and nudge it
  // back into view with a translate, mirroring ContextMenu's edge-flip.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const apply = () => {
      // Reset before measuring so the clamp is computed from the true
      // anchored position, not a previously-applied offset.
      node.style.transform = "";
      const rect = node.getBoundingClientRect();
      const { dx, dy } = clampToViewport(rect, window.innerWidth, window.innerHeight);
      if (dx !== 0 || dy !== 0) node.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    apply();
    const RO = window.ResizeObserver;
    const ro = RO ? new RO(() => apply()) : null;
    ro?.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [x, y]);

  // Click-outside cancels.
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

  const trimmedBody = body.trim();
  const trimmedReplacement = replacement.trim();
  const valid = suggesting ? trimmedReplacement.length > 0 : trimmedBody.length > 0;

  const submit = () => {
    if (!valid) return;
    if (suggesting) onSubmitSuggestion(trimmedReplacement, trimmedBody);
    else onSubmitComment(trimmedBody);
  };

  const onKey: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      ref={containerRef}
      className="fm-composer"
      data-testid="fm-composer"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label={suggesting ? "Suggest edit" : "New comment"}
    >
      <div className="fm-composer-header">
        <span className="fm-composer-author">{author}</span>
        <span className="fm-composer-author-muted">
          is {suggesting ? "suggesting" : "commenting"}
        </span>
      </div>
      {selectionPreview && !suggesting && (
        <div className="fm-composer-selection" title={selectionPreview}>
          “{truncate(selectionPreview, 80)}”
        </div>
      )}
      {suggesting ? (
        <>
          <div className="fm-composer-suggest-fields">
            <label className="fm-composer-field-label">Original</label>
            <div className="fm-composer-readonly" data-testid="fm-composer-original">
              {selectionPreview || "(empty selection)"}
            </div>
            <label className="fm-composer-field-label" htmlFor="fm-composer-replacement">
              Replacement
            </label>
            <textarea
              id="fm-composer-replacement"
              ref={replacementRef}
              className="fm-composer-textarea"
              placeholder="Type the replacement…"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={onKey}
              data-testid="fm-composer-replacement"
            />
          </div>
          <textarea
            ref={bodyRef}
            className="fm-composer-textarea fm-composer-body-optional"
            placeholder="Add a note (optional)…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKey}
            data-testid="fm-composer-textarea"
          />
        </>
      ) : (
        <textarea
          ref={bodyRef}
          className="fm-composer-textarea"
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          data-testid="fm-composer-textarea"
        />
      )}
      <div className="fm-composer-footer">
        <button
          type="button"
          className={"fm-composer-toggle" + (suggesting ? " is-active" : "")}
          onClick={() => setSuggesting((s) => !s)}
          aria-pressed={suggesting}
          data-testid="fm-composer-suggest-toggle"
        >
          Suggest edit
        </button>
        <span className="fm-composer-hint" aria-hidden>
          ⌘↵ to submit
        </span>
        <button
          type="button"
          className="fm-composer-submit"
          disabled={!valid}
          onClick={submit}
          data-testid="fm-composer-submit"
        >
          {suggesting ? "Suggest" : "Comment"}
        </button>
      </div>
    </div>
  );
}

// Compute the translate offset needed to bring a fixed-position panel
// fully within the viewport. Horizontal and vertical are clamped
// independently: first pull the overflowing edge in, then guard the
// opposite edge so we never push the panel's top/left off-screen (which
// would hide the header / the very controls we're trying to reveal).
export function clampToViewport(
  rect: { top: number; left: number; right: number; bottom: number },
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (rect.right > viewportWidth - margin) dx = viewportWidth - margin - rect.right;
  if (rect.left + dx < margin) dx = margin - rect.left;
  if (rect.bottom > viewportHeight - margin) dy = viewportHeight - margin - rect.bottom;
  if (rect.top + dy < margin) dy = margin - rect.top;
  return { dx, dy };
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  const next = Math.max(36, Math.min(180, el.scrollHeight));
  el.style.height = next + "px";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
