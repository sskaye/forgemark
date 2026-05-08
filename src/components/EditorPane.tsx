import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "../state/DocumentProvider";
import { useAuthorName } from "../state/preferences";
import { RenderedView, type RenderedViewHandle } from "./RenderedView";
import { SourceView, type SourceViewHandle } from "./SourceView";
import { NewCommentComposer } from "./NewCommentComposer";
import { LostAnchorBanner } from "./LostAnchorBanner";
import { ContextMenu } from "./ContextMenu";
import { nextCommentId, serializeForgemarkFile, type AnchorStatus } from "../format";
import "./EditorPane.css";

type Props = {
  anchorStatuses: Map<number, AnchorStatus>;
};

// Editor pane. Switches between the rendered (Tiptap) view and the raw
// markdown source. The pane scrolls vertically; the document caps at
// 720px wide and centres inside the pane.
//
// Phase 5: hosts the new-comment composer. Selection is captured from
// the rendered view via a ref; on submit, the rendered view applies the
// anchor mark and returns the new body, which is dispatched along with
// the new Comment.
//
// Phase 8: source view is now CodeMirror-based with a "read-only review"
// chip overlay. Card-click focus changes scroll the source view to the
// matching marker via the SourceView imperative handle.
export function EditorPane({ anchorStatuses }: Props) {
  const { state, dispatch } = useDocument();
  const [author] = useAuthorName();
  const handleRef = useRef<RenderedViewHandle | null>(null);
  const sourceRef = useRef<SourceViewHandle | null>(null);
  // Right-click context menu state. Lives here (not in document
  // state) because it's strictly local to the editor pane and
  // shouldn't survive viewMode toggles or external state events.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Composer trigger: ⌘⌥M (or the right-click menu) opens the
  // composer at the current selection. Selections inside fenced code
  // blocks or inline code spans are refused, mirroring the
  // parser-level rule from Phase 3. In Source view the trigger is a
  // no-op — Source is read-only review.
  const openComposer = useCallback(
    (initialMode: "comment" | "suggest" = "comment") => {
      if (state.viewMode !== "rendered") return;
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
          initialMode,
        },
      });
    },
    [dispatch, state.viewMode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.altKey) return;
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        openComposer();
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        openComposer("suggest");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openComposer]);

  // Right-click handling. Three regions:
  //   - inside a textarea / input: let the OS native menu show.
  //   - inside the rendered editor with a non-empty selection: show
  //     our custom menu (New Comment / Suggest Edit).
  //   - anywhere else (incl. rendered editor with no selection):
  //     suppress the default menu, show nothing.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow the OS menu inside form controls (composer textareas,
      // settings inputs).
      if (target.closest("textarea, input")) return;
      // Inside the rendered editor: show the custom menu when there
      // is a non-empty selection.
      const inRendered = target.closest(".fm-rendered-view");
      if (inRendered && state.viewMode === "rendered") {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
        return;
      }
      // Everywhere else (sidebar, modals outside textareas, banners,
      // title bar): suppress.
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, [state.viewMode]);

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

  // Source view always shows the *current* serialized form (body +
  // trailing comments block) — not the bytes-as-loaded — so toggling
  // back and forth after edits reflects what would be written to disk.
  const sourceText = useMemo(
    () =>
      state.viewMode === "source"
        ? serializeForgemarkFile({ body: state.body, comments: state.comments })
        : "",
    [state.viewMode, state.body, state.comments],
  );

  // Card focus → scroll source to its marker. Only fires in Source mode;
  // the rendered view does its own scrolling via DOM measurement.
  useEffect(() => {
    if (state.viewMode !== "source") return;
    if (state.focusedCommentId == null) return;
    sourceRef.current?.scrollToMarker(state.focusedCommentId);
  }, [state.viewMode, state.focusedCommentId]);

  // Phase 9: count lost anchors. The banner picks the *first* lost
  // anchor (by id) when the user clicks Recover, then the modal
  // walks remaining orphans on subsequent clicks.
  const lostAnchorIds: number[] = [];
  for (const c of state.comments) {
    const st = anchorStatuses.get(c.id);
    if (st && st.kind === "orphaned") lostAnchorIds.push(c.id);
  }

  return (
    <main className="fm-editor-pane" data-testid="fm-editor-pane" role="main">
      {state.viewMode === "source" && (
        <aside
          className="fm-source-chip"
          data-testid="fm-source-chip"
          title="You can read here, but commenting only works in Rendered view."
          aria-label="Source view, read-only review"
        >
          <span className="fm-source-chip-dot" aria-hidden="true" />
          <span>Source view · read-only review</span>
        </aside>
      )}
      <div className="fm-document">
        <LostAnchorBanner
          count={lostAnchorIds.length}
          onRecover={() => {
            if (lostAnchorIds.length === 0) return;
            dispatch({ type: "openReattach", commentId: lostAnchorIds[0] });
          }}
        />
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
          <SourceView ref={sourceRef} text={sourceText} />
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
          initialMode={state.composer.initialMode}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: "New Comment",
              onSelect: () => openComposer("comment"),
              testid: "fm-context-new-comment",
            },
            {
              label: "Suggest Edit",
              onSelect: () => openComposer("suggest"),
              testid: "fm-context-suggest-edit",
            },
          ]}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </main>
  );
}
