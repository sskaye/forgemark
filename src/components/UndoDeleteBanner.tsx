import { useEffect } from "react";
import { useDocument } from "../state/DocumentProvider";
import "./UndoDeleteBanner.css";

// A deleted comment can be brought back for a few seconds. Deleting is a
// single keystroke on a focused card and takes the whole thread with it;
// a confirm dialog would tax every deletion to guard the rare mistake,
// while this costs nothing until it is needed.
const LINGER_MS = 8000;

export function UndoDeleteBanner() {
  const { state, dispatch } = useDocument();
  const last = state.lastDeleted;

  useEffect(() => {
    if (!last) return;
    const handle = window.setTimeout(() => dispatch({ type: "dismissUndoDelete" }), LINGER_MS);
    return () => window.clearTimeout(handle);
  }, [last, dispatch]);

  if (!last) return null;
  const replies = last.comment.replies?.length ?? 0;
  const what = last.comment.suggested_edit
    ? "suggestion"
    : last.comment.floating
      ? "note"
      : "comment";
  return (
    <div className="fm-undo-banner" role="status" data-testid="fm-undo-delete">
      <span className="fm-undo-banner-message">
        Deleted {what} #{last.comment.id}
        {replies > 0 ? ` and ${replies} ${replies === 1 ? "reply" : "replies"}` : ""}.
      </span>
      <button
        type="button"
        className="fm-undo-banner-button"
        data-testid="fm-undo-delete-button"
        onClick={() => dispatch({ type: "undoDelete" })}
      >
        Undo
      </button>
      <button
        type="button"
        className="fm-undo-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => dispatch({ type: "dismissUndoDelete" })}
      >
        ×
      </button>
    </div>
  );
}
