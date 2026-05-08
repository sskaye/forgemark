import { useDocument } from "../state/DocumentProvider";
import { RenderedView } from "./RenderedView";
import { SourceView } from "./SourceView";
import "./EditorPane.css";

// Editor pane. Switches between the rendered (Tiptap) view and the raw
// markdown source. The pane scrolls vertically; the document caps at
// 720px wide and centres inside the pane.
//
// Phase 4: when a file has comments, the editor is set read-only — the
// round-trip-safe edit story for inline anchors lands in Phase 5.
export function EditorPane() {
  const { state, setBody, dispatch } = useDocument();
  // For Phase 4, treat editor as read-only when there are anchored
  // comments to protect markers from drift. Untitled and comment-free
  // files stay editable.
  const editable = state.comments.length === 0 && !state.readOnly;
  return (
    <main className="fm-editor-pane" data-testid="fm-editor-pane" role="main">
      <div className="fm-document">
        {state.viewMode === "rendered" ? (
          <RenderedView
            body={state.body}
            onEdit={setBody}
            readOnly={!editable}
            focusedCommentId={state.focusedCommentId}
            hoveredCommentId={state.hoveredCommentId}
            onAnchorClick={(id) => dispatch({ type: "setFocusedComment", id })}
            onAnchorHover={(id) => dispatch({ type: "setHoveredComment", id })}
          />
        ) : (
          <SourceView text={state.originalText || state.body} />
        )}
      </div>
    </main>
  );
}
