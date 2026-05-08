import "./EditorPane.css";

// Phase 1: empty editor pane with the document max-width (720px) centred.
// The ProseMirror surface lands in Phase 2; the inline anchors in Phase 4.
export function EditorPane() {
  return (
    <main className="fm-editor-pane" data-testid="fm-editor-pane" role="main">
      <div className="fm-document">
        {/* Empty in Phase 1 — see Phase 2 for markdown rendering */}
      </div>
    </main>
  );
}
