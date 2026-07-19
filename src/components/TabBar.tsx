import { useWorkspace } from "../state/DocumentProvider";
import "./TabBar.css";

// Tab strip for open documents. Sits below the title bar rather than
// inside it: `.fm-titlebar-title` is absolutely positioned and hostile to
// inline growth, and the title bar already hosts a `role="tablist"`
// segmented control for Rendered/Source — two tablists in one row would
// be ambiguous both visually and for screen readers.
//
// Hidden entirely while a single document is open, so the app stays as
// quiet as it was before tabs existed.
export function TabBar() {
  const { workspace, dispatch } = useWorkspace();
  if (workspace.order.length < 2) return null;

  return (
    <div className="fm-tabbar" role="tablist" aria-label="Open documents" data-testid="fm-tabbar">
      {workspace.order.map((id) => {
        const doc = workspace.docs[id];
        const active = id === workspace.activeId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            // The tab itself is focusable and activates on click; the
            // close control is a nested button, so stop its clicks from
            // selecting the tab on the way out.
            tabIndex={active ? 0 : -1}
            className={"fm-tab" + (active ? " fm-tab-active" : "")}
            data-testid={`fm-tab-${id}`}
            title={doc.filePath ?? doc.fileName}
            onClick={() => dispatch({ type: "activateTab", docId: id })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dispatch({ type: "activateTab", docId: id });
              }
            }}
          >
            <span className="fm-tab-name">{doc.fileName}</span>
            {doc.dirty && (
              <span className="fm-tab-dot" aria-label="Unsaved changes" title="Unsaved changes">
                •
              </span>
            )}
            <button
              type="button"
              className="fm-tab-close"
              aria-label={`Close ${doc.fileName}`}
              data-testid={`fm-tab-close-${id}`}
              onClick={(e) => {
                e.stopPropagation();
                // Routed through the menu event the unsaved-work guard
                // already listens for, so closing a tab from the strip
                // gets the same save prompt as File > Close.
                dispatch({ type: "activateTab", docId: id });
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("forgemark:menu", { detail: "close-file" }));
                }, 0);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
