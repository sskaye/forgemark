import { useEffect, useMemo, useState } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "./EditorPane";
import { ErrorBanner } from "./ErrorBanner";
import { ReattachModal } from "./ReattachModal";
import { FileConflictBanner } from "./FileConflictBanner";
import { EditDuringOpenModal } from "./EditDuringOpenModal";
import { SaveConflictModal } from "./SaveConflictModal";
import { useDocument } from "../state/DocumentProvider";
import { DocumentBindings } from "../state/DocumentBindings";
import { classifyAnchors, insertMarkersIntoBody, removeMarkersFromBody } from "../format";
import { contextSnippet } from "../format";
import "./AppShell.css";

// Phase 2 shell: the top-level layout, plus the document keyboard bindings
// and auto-save effect. Real content (editor, sidebar comments) lives in
// EditorPane and Sidebar.
export function AppShell() {
  const { state, dispatch, setViewMode } = useDocument();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Anchor classification (Phase 9). Recomputed when body or comments
  // change. classifyAnchors does one marker scan + per-orphan candidate
  // generation, which the perf test bounds at < 2s for 50k-word bodies.
  const anchorStatuses = useMemo(
    () => classifyAnchors(state.body, state.comments),
    [state.body, state.comments],
  );

  const reattachTargetComment =
    state.reattachTarget != null ? state.comments.find((c) => c.id === state.reattachTarget) : null;
  const reattachTargetStatus =
    reattachTargetComment != null ? anchorStatuses.get(reattachTargetComment.id) : null;

  // Reflect file state in the document title (browser tab and Tauri OS title).
  useEffect(() => {
    const dotted = state.dirty ? "• " : "";
    document.title = `Forgemark — ${dotted}${state.fileName}`;
  }, [state.fileName, state.dirty]);

  return (
    <div className="fm-app-shell" data-testid="fm-app-shell">
      <DocumentBindings />
      <TitleBar
        fileName={state.fileName}
        modified={state.dirty}
        viewMode={state.viewMode}
        onViewModeChange={setViewMode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
      />
      <ErrorBanner />
      {/* Phase 10 — file-conflict surfaces. The banner shows when the
          file changed on disk but we have no unsaved work; the
          edit-during-open modal blocks when there *is* unsaved work; the
          save-conflict modal opens when ⌘S is pressed mid-conflict. The
          three-way decision lives here so DocumentBindings can stay
          focused on side effects. */}
      {state.externalChange != null && !state.dirty && !state.saveConflictOpen && (
        <FileConflictBanner
          onKeepYours={() => dispatch({ type: "dismissExternalChange" })}
          onReloadFromDisk={() => dispatch({ type: "applyExternalChange" })}
        />
      )}
      {state.externalChange != null &&
        state.dirty &&
        !state.editDuringOpenDismissed &&
        !state.saveConflictOpen && (
          <EditDuringOpenModal
            state={state}
            onCancel={() => dispatch({ type: "dismissEditDuringOpen" })}
            onKeepYours={() => dispatch({ type: "dismissExternalChange" })}
            onReloadFromDisk={() => dispatch({ type: "applyExternalChange" })}
          />
        )}
      {/* Banner stays visible even with unsaved work once the user
          clicks Cancel on the edit-during-open modal — the conflict is
          still pending and we want to keep it surfaced. */}
      {state.externalChange != null &&
        state.dirty &&
        state.editDuringOpenDismissed &&
        !state.saveConflictOpen && (
          <FileConflictBanner
            onKeepYours={() => dispatch({ type: "dismissExternalChange" })}
            onReloadFromDisk={() => dispatch({ type: "applyExternalChange" })}
          />
        )}
      {state.saveConflictOpen && state.externalChange != null && (
        <SaveConflictModal
          state={state}
          onCancel={() => dispatch({ type: "dismissSaveConflict" })}
          onOverwrite={() => {
            // Drop the externalChange (so the next save isn't gated)
            // and request a save. DocumentBindings owns the file IO
            // and consumes the request via a useEffect on pendingSave.
            dispatch({ type: "dismissExternalChange" });
            dispatch({ type: "requestSave" });
          }}
        />
      )}
      <div className="fm-app-body">
        <EditorPane anchorStatuses={anchorStatuses} />
        {sidebarOpen && <Sidebar anchorStatuses={anchorStatuses} />}
      </div>
      {reattachTargetComment && reattachTargetStatus?.kind === "orphaned" && (
        <ReattachModal
          comment={reattachTargetComment}
          candidates={reattachTargetStatus.candidates}
          body={state.body}
          onCancel={() => dispatch({ type: "closeReattach" })}
          onReattach={(candidate) => {
            const id = reattachTargetComment.id;
            // Insert marker pair around the chosen range and recompute
            // the anchor metadata from the *new* surroundings, mirroring
            // what the new-comment composer does.
            const newBody = insertMarkersIntoBody(state.body, candidate.from, candidate.to, id);
            const before = state.body.slice(Math.max(0, candidate.from - 200), candidate.from);
            const after = state.body.slice(candidate.to, candidate.to + 200);
            dispatch({
              type: "reattachComment",
              commentId: id,
              body: newBody,
              anchor_text: candidate.text,
              context_before: contextSnippet(before, "before"),
              context_after: contextSnippet(after, "after"),
            });
          }}
          onKeepFloating={() => {
            // For a true orphan, no markers are present in the body, so
            // removeMarkersFromBody is a no-op. We still call it
            // defensively in case markers exist for some other reason
            // (e.g. partially edited file).
            const id = reattachTargetComment.id;
            const newBody = removeMarkersFromBody(state.body, id);
            dispatch({ type: "convertToFloating", commentId: id, body: newBody });
          }}
          onDiscard={() => {
            const id = reattachTargetComment.id;
            const newBody = removeMarkersFromBody(state.body, id);
            dispatch({ type: "deleteComment", commentId: id, body: newBody });
          }}
        />
      )}
    </div>
  );
}
