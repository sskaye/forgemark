import { useDocument } from "../state/DocumentProvider";
import { RenderedView } from "./RenderedView";
import { SourceView } from "./SourceView";
import "./EditorPane.css";

// Editor pane. Shows either the Tiptap rendered view (Phase 2 default) or
// the raw markdown source. The pane scrolls vertically; the document
// itself caps at 720px wide and centres inside the pane.
export function EditorPane() {
  const { state, setBody } = useDocument();
  return (
    <main className="fm-editor-pane" data-testid="fm-editor-pane" role="main">
      <div className="fm-document">
        {state.viewMode === "rendered" ? (
          <RenderedView initialMarkdown={state.body} onEdit={setBody} readOnly={state.readOnly} />
        ) : (
          <SourceView text={state.body} />
        )}
      </div>
    </main>
  );
}
