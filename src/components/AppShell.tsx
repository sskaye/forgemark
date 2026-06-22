import { useCallback, useEffect, useMemo, useState } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "./EditorPane";
import { ErrorBanner } from "./ErrorBanner";
import { ReattachModal } from "./ReattachModal";
import { FileConflictBanner } from "./FileConflictBanner";
import { EditDuringOpenModal } from "./EditDuringOpenModal";
import { SaveConflictModal } from "./SaveConflictModal";
import { SettingsModal } from "./SettingsModal";
import { CleanExportModal } from "./CleanExportModal";
import { PrintDocument } from "./PrintDocument";
import { PrintOptionsModal, type PrintOptions } from "./PrintOptionsModal";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { useDocument } from "../state/DocumentProvider";
import { DocumentBindings } from "../state/DocumentBindings";
import {
  classifyAnchors,
  insertMarkersIntoBody,
  removeMarkersFromBody,
  cleanExport,
} from "../format";
import { contextSnippet, parseForgemarkFile } from "../format";
import { useFontSize, useFirstRun } from "../state/preferences";
import { saveMarkdownFile } from "../services/fileIO";
import { applyWindowAction, isWindowAction } from "../services/windowActions";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import "./AppShell.css";
// Bundled sample file — Vite's `?raw` import pulls in the markdown text
// at build time so the first-run "Open sample" path doesn't need a
// fetch or filesystem call.
import SAMPLE_TEXT from "../../assets/sample-onboarding.md?raw";

// Phase 2 shell: the top-level layout, plus the document keyboard bindings
// and auto-save effect. Real content (editor, sidebar comments) lives in
// EditorPane and Sidebar.
export function AppShell() {
  const { state, dispatch, setViewMode } = useDocument();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cleanExportOpen, setCleanExportOpen] = useState(false);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printOptions, setPrintOptions] = useState<PrintOptions | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [fontSize] = useFontSize();
  const { firstRunDone, markDone } = useFirstRun();

  const requestViewModeChange = useCallback(
    (viewMode: "rendered" | "source") => {
      if (viewMode === state.viewMode) return;
      window.dispatchEvent(
        new CustomEvent("forgemark:capture-view-sync", {
          detail: { from: state.viewMode, to: viewMode },
        }),
      );
      setViewMode(viewMode);
    },
    [setViewMode, state.viewMode],
  );

  // Apply font-size preference as a CSS custom property on the
  // document root so all prose surfaces inherit it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--fm-font-size", fontSize + "px");
  }, [fontSize]);

  const continueToPrint = (options: PrintOptions) => {
    setPrintOptions(options);
    setPrintOptionsOpen(false);
    setPrintRequestId((id) => id + 1);
  };

  useEffect(() => {
    if (printRequestId === 0 || !printOptions) return;
    let cancelled = false;
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? (cb: () => void) => window.requestAnimationFrame(() => window.requestAnimationFrame(cb))
        : (cb: () => void) => window.setTimeout(cb, 0);
    schedule(async () => {
      if (cancelled) return;
      try {
        await invoke("print_current_webview");
      } catch {
        window.print();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [printOptions, printRequestId]);

  // Phase 11 keyboard shortcuts that aren't tied to the document
  // model: Settings (⌘,), Clean Export (⌘⇧E), and Print (⌘P).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPrintOptionsOpen(true);
      } else if (e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (state.filePath) setCleanExportOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.filePath]);

  // Native menu bridge — `forgemark:menu` DOM CustomEvents arrive
  // from src/state/menuBridge.ts after the Rust side fires a menu
  // command. Each id routes to the matching JS-side action.
  useEffect(() => {
    const onCustom = async (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "settings") {
        setSettingsOpen(true);
        return;
      }
      if (detail === "clean-export") {
        if (state.filePath) setCleanExportOpen(true);
        return;
      }
      if (detail === "print") {
        setPrintOptionsOpen(true);
        return;
      }
      if (detail === "close-file") {
        // File > Close — clear the document, keep the window open
        // (TextEdit / Pages convention). Prompt before discarding
        // unsaved work via Tauri's dialog plugin (window.confirm()
        // is suppressed in the Tauri webview; ask() is the
        // platform-appropriate equivalent).
        if (state.dirty) {
          const proceed = await ask("You have unsaved changes. Close without saving?", {
            title: "Close document",
            kind: "warning",
            okLabel: "Discard changes",
            cancelLabel: "Cancel",
          });
          if (!proceed) return;
        }
        dispatch({ type: "newUntitled" });
        return;
      }
      if (isWindowAction(detail)) {
        try {
          await applyWindowAction(detail);
        } catch (err) {
          dispatch({
            type: "error",
            message: "Window resize failed: " + (err instanceof Error ? err.message : String(err)),
          });
        }
        return;
      }
    };
    window.addEventListener("forgemark:menu", onCustom);
    return () => window.removeEventListener("forgemark:menu", onCustom);
  }, [state.filePath, state.dirty, dispatch]);

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
        onViewModeChange={requestViewModeChange}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
        onOpenSettings={() => setSettingsOpen(true)}
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
      {printOptions && (
        <PrintDocument
          body={state.body}
          comments={state.comments}
          fileName={state.fileName}
          filePath={state.filePath}
          options={printOptions}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {printOptionsOpen && (
        <PrintOptionsModal
          onCancel={() => setPrintOptionsOpen(false)}
          onContinue={continueToPrint}
        />
      )}
      {cleanExportOpen && state.filePath && (
        <CleanExportModal
          commentCount={state.comments.length}
          onCancel={() => setCleanExportOpen(false)}
          onConfirm={async () => {
            const text = cleanExport(state.body, state.comments);
            // Default name: "<basename>-clean.md"
            const baseName = state.fileName.replace(/\.(md|markdown)$/i, "");
            const defaultPath = baseName + "-clean.md";
            try {
              await saveMarkdownFile(null, text);
              setCleanExportOpen(false);
              // Hint the OS save dialog name via the fileIO layer's
              // save() — its current signature takes no default name,
              // so we just write through. Phase 13 may polish.
              void defaultPath;
            } catch (err) {
              setCleanExportOpen(false);
              dispatch({
                type: "error",
                message: "Clean Export failed: " + (err as Error).message,
              });
            }
          }}
        />
      )}
      {!firstRunDone && (
        <FirstRunWelcome
          onSkip={markDone}
          onOpenSample={() => {
            try {
              const parsed = parseForgemarkFile(SAMPLE_TEXT, { tolerant: true });
              dispatch({
                type: "load",
                filePath: null,
                fileName: "sample-onboarding.md",
                text: SAMPLE_TEXT,
                body: parsed.body,
                comments: parsed.comments,
                readOnly: false,
              });
            } catch (err) {
              dispatch({
                type: "error",
                message: "Couldn't load sample: " + (err as Error).message,
              });
            }
            markDone();
          }}
        />
      )}
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
