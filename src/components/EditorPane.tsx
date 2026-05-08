import { useCallback, useEffect, useRef } from "react";
import { useDocument } from "../state/DocumentProvider";
import { useAuthorName } from "../state/preferences";
import { RenderedView, type RenderedViewHandle } from "./RenderedView";
import { SourceView } from "./SourceView";
import { NewCommentComposer } from "./NewCommentComposer";
import { nextCommentId } from "../format";
import "./EditorPane.css";

// Editor pane. Switches between the rendered (Tiptap) view and the raw
// markdown source. The pane scrolls vertically; the document caps at
// 720px wide and centres inside the pane.
//
// Phase 5: hosts the new-comment composer. Selection is captured from
// the rendered view via a ref; on submit, the rendered view applies the
// anchor mark and returns the new body, which is dispatched along with
// the new Comment.
export function EditorPane() {
  const { state, dispatch } = useDocument();
  const [author] = useAuthorName();
  const handleRef = useRef<RenderedViewHandle | null>(null);

  // Composer trigger: ⌘⌥M opens the composer at the current selection.
  // Selections inside fenced code blocks or inline code spans are
  // refused, mirroring the parser-level rule from Phase 3.
  const openComposer = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const captured = handle.captureSelection();
    if (!captured) return; // empty / collapsed selection
    if (captured.insideCode) return; // selection inside fenced or inline code
    dispatch({
      type: "openComposer",
      composer: {
        mode: "new",
        from: captured.from,
        to: captured.to,
        selectionText: captured.text,
        contextBefore: captured.contextBefore,
        contextAfter: captured.contextAfter,
        x: captured.rect.left,
        y: captured.rect.bottom + 6,
      },
    });
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.altKey) return;
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        openComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openComposer]);

  const submitComment = useCallback(
    (commentBody: string) => {
      const c = state.composer;
      if (!c || c.mode !== "new") return;
      const handle = handleRef.current;
      if (!handle) return;
      const id = nextCommentId(state.comments);
      const newBody = handle.applyAnchor(c.from, c.to, id);
      dispatch({
        type: "addComment",
        body: newBody,
        comment: {
          id,
          anchor_text: c.selectionText,
          context_before: c.contextBefore,
          context_after: c.contextAfter,
          author,
          timestamp: new Date().toISOString(),
          resolved: false,
          body: commentBody,
        },
      });
    },
    [state.composer, state.comments, author, dispatch],
  );

  // Phase 7: suggested-edit submission. The composer captures both the
  // proposed replacement and an (optional) accompanying body. We apply
  // the same anchor mark as a regular new comment, then store the
  // Comment with `suggested_edit: { from, to }` and an optional body.
  const submitSuggestion = useCallback(
    (replacement: string, optionalBody: string) => {
      const c = state.composer;
      if (!c || c.mode !== "new") return;
      const handle = handleRef.current;
      if (!handle) return;
      const id = nextCommentId(state.comments);
      const newBody = handle.applyAnchor(c.from, c.to, id);
      dispatch({
        type: "addComment",
        body: newBody,
        comment: {
          id,
          anchor_text: c.selectionText,
          context_before: c.contextBefore,
          context_after: c.contextAfter,
          author,
          timestamp: new Date().toISOString(),
          resolved: false,
          // body is optional for suggestions per the schema; only
          // include it when the user typed something.
          ...(optionalBody.length > 0 ? { body: optionalBody } : {}),
          suggested_edit: { from: c.selectionText, to: replacement },
        },
      });
    },
    [state.composer, state.comments, author, dispatch],
  );

  const cancelComposer = useCallback(() => dispatch({ type: "closeComposer" }), [dispatch]);

  // Phase 4 said the editor stays read-only when comments exist; Phase 5
  // keeps the same posture for free-form prose editing. Selection still
  // works in read-only Tiptap, which is what the composer needs.
  const editorReadOnly = state.readOnly;

  return (
    <main className="fm-editor-pane" data-testid="fm-editor-pane" role="main">
      <div className="fm-document">
        {state.viewMode === "rendered" ? (
          <RenderedView
            body={state.body}
            onEdit={() => {}}
            readOnly={editorReadOnly}
            focusedCommentId={state.focusedCommentId}
            hoveredCommentId={state.hoveredCommentId}
            onAnchorClick={(id) => dispatch({ type: "setFocusedComment", id })}
            onAnchorHover={(id) => dispatch({ type: "setHoveredComment", id })}
            handleRef={handleRef}
          />
        ) : (
          <SourceView text={state.originalText || state.body} />
        )}
      </div>
      {state.composer?.mode === "new" && state.viewMode === "rendered" && (
        <NewCommentComposer
          x={state.composer.x}
          y={state.composer.y}
          selectionPreview={state.composer.selectionText}
          onSubmitComment={submitComment}
          onSubmitSuggestion={submitSuggestion}
          onCancel={cancelComposer}
        />
      )}
    </main>
  );
}
