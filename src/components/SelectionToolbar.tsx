import { useEffect, useRef } from "react";
import "./SelectionToolbar.css";

type Props = {
  // Host-viewport coordinates of the selection's top-left.
  x: number;
  y: number;
  onComment: () => void;
  onSuggest: () => void;
  // Hidden when a suggestion can't be represented for this selection —
  // the same rule the composer's toggle follows.
  allowSuggest?: boolean;
};

// The affordance for commenting on a passage of an HTML report.
//
// A report is rendered in an iframe, and right-click there belongs to the
// embedder: WKWebView shows its own "Look Up / Translate / Copy" menu, and
// a `contextmenu` listener the host attached inside the frame does not
// reliably get to suppress it. So the primary way in cannot be a
// right-click — it has to be something Forgemark draws itself.
//
// This floats above the selection the moment there is one, which also
// makes it discoverable in a way right-click never was. ⌘⌥M still works,
// and the figure hover affordance is the same idea for blocks that have
// no text to select.
export function SelectionToolbar({ x, y, onComment, onSuggest, allowSuggest = true }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Keep it on screen: nudge inward when the selection is near an edge,
  // and drop below it when there is no room above.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The nudge from the previous selection must not compound.
    node.style.transform = "";
    const r = node.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < 8) dx = 8 - r.left;
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right;
    if (r.top < 8) dy = r.height + 16;
    if (dx || dy) node.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fm-selection-toolbar"
      data-testid="fm-selection-toolbar"
      role="toolbar"
      aria-label="Comment on selection"
      style={{ left: x, top: y }}
      // Taking the mousedown would clear the very selection we are about
      // to anchor to.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="fm-selection-toolbar-button"
        onClick={onComment}
        data-testid="fm-selection-comment"
      >
        Comment
      </button>
      {allowSuggest && (
        <button
          type="button"
          className="fm-selection-toolbar-button"
          onClick={onSuggest}
          data-testid="fm-selection-suggest"
        >
          Suggest edit
        </button>
      )}
    </div>
  );
}
