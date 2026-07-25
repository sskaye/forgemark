import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkspace } from "./DocumentProvider";
import type { PendingIntent } from "./document";
import { anyDirty, type DocId } from "./workspace";
import { invoke } from "@tauri-apps/api/core";
import { openMarkdownFiles, saveMarkdownFile, readMarkdownFile } from "../services/fileIO";
import {
  parseForgemarkFile,
  recoverForgemarkFile,
  serializeForgemarkFile,
  ForgemarkParseError,
  type RecoveryResult,
} from "../format";
import { fingerprint, type FileFingerprint } from "../services/conflict";
import { watchMarkdownFile, type FileWatcher } from "../services/fileWatcher";
import { useRecentFiles, useDefaultView } from "./preferences";

type Logger = (msg: string, err: unknown) => void;

const defaultLogger: Logger = (msg, err) => {
  console.error("[forgemark] " + msg, err);
};

function errorMessage(prefix: string, err: unknown): string {
  if (err instanceof Error) return prefix + ": " + err.message;
  return prefix + ": " + String(err);
}

// Message shown when strict parse failed but fail-soft recovery ran. When
// recovery salvaged comments we tell the user what to expect; otherwise we
// fall back to the original "loaded as plain markdown" surfacing.
function recoveryMessage(err: unknown, recovery: RecoveryResult): string {
  if (recovery.recovered && recovery.file.comments.length > 0) {
    return `Some comment anchors were damaged. Recovered ${recovery.file.comments.length} comment(s); any showing a lost anchor can be reattached.`;
  }
  return err instanceof ForgemarkParseError
    ? `Comments block couldn't be parsed (${err.kind}); loaded as plain markdown.`
    : errorMessage("Couldn't parse comment block", err);
}

// Phase 2 ergonomic bindings — live until Phase 11 wires the native menu
// bar. Renders nothing.
//
//   ⌘O / Ctrl+O — open file dialog
//   ⌘S / Ctrl+S — save (dirty: write body; clean: write original bytes)
//   ⌘N / Ctrl+N — new untitled buffer (goes through guardDiscard, so
//                  unsaved work is saved or explicitly discarded first)
//
// Auto-save: when a file path is set and the document is dirty, schedules
// a save 500ms after the last edit. Untitled buffers never auto-save —
// the user must ⌘S to choose a destination.
export function DocumentBindings({
  docId,
  logger = defaultLogger,
}: {
  // Which open document these bindings serve. Omitted means "the active
  // one", which is how every pre-tabs caller uses it.
  docId?: DocId;
  logger?: Logger;
}) {
  const { workspace, dispatch: workspaceDispatch, dispatchTo } = useWorkspace();
  const id = docId ?? workspace.activeId;
  const state = workspace.docs[id];
  // Window-level listeners (shortcuts, menu commands, quit) are app-wide
  // singletons — only the active document's instance may own them, or N
  // open documents would each save, each open, each prompt.
  const isActive = id === workspace.activeId;

  const dispatch = useMemo(() => dispatchTo(id), [dispatchTo, id]);
  const { recordOpened, remove: removeRecent } = useRecentFiles();
  const [defaultView] = useDefaultView();
  // Hold the default view in a ref so the load handler reads the
  // freshest value without re-binding the keydown effect.
  const defaultViewRef = useRef(defaultView);
  defaultViewRef.current = defaultView;
  const recordOpenedRef = useRef(recordOpened);
  recordOpenedRef.current = recordOpened;
  const removeRecentRef = useRef(removeRecent);
  removeRecentRef.current = removeRecent;

  // Stable refs to read latest state in event handlers without re-binding.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Unsaved work is an app-wide question, not a per-document one: closing
  // the window has to consider background tabs too.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const workspaceDispatchRef = useRef(workspaceDispatch);
  workspaceDispatchRef.current = workspaceDispatch;
  const idRef = useRef(id);
  idRef.current = id;

  // guardDiscard is declared further down (it needs performSave), but the
  // open-path listener above has to reach it. A ref keeps that listener
  // bound once instead of re-subscribing on every render.
  const guardDiscardRef = useRef<(intent: PendingIntent) => Promise<void>>(async () => {});

  // Phase 10: baseline fingerprint of the bytes we last read or wrote.
  // The watcher consults this to ignore re-fires triggered by our own
  // saves (mtime changes, content matches, fingerprint unchanged).
  const baselineRef = useRef<FileFingerprint>({ mtimeMs: null, hash: "" });

  // Refresh the baseline whenever filePath / originalText change. Both
  // load (file open) and saved transitions update originalText.
  useEffect(() => {
    let cancelled = false;
    if (!state.filePath) {
      baselineRef.current = { mtimeMs: null, hash: "" };
      return;
    }
    (async () => {
      const fp = await fingerprint(state.originalText, null);
      if (!cancelled) baselineRef.current = fp;
    })();
    return () => {
      cancelled = true;
    };
  }, [state.filePath, state.originalText]);

  // Phase 11: open a specific path (e.g. via Open Recent). Same logic
  // as ⌘O's chosen-path branch — kept as a callable so non-keyboard
  // surfaces can drive it.
  const openPath = useCallback(
    async (path: string) => {
      try {
        const opened = await readMarkdownFile(path);
        let parsed;
        try {
          parsed = parseForgemarkFile(opened.text, { tolerant: true });
        } catch (err) {
          // Fail soft: recover as many comments as possible instead of
          // blanking every comment on a single damaged anchor.
          const recovery = recoverForgemarkFile(opened.text);
          parsed = recovery.file;
          dispatch({ type: "error", message: recoveryMessage(err, recovery) });
        }
        // Open in a tab. `openTab` focuses an existing tab if this file
        // is already open, and reuses the current one if it's an
        // untouched Untitled buffer.
        workspaceDispatchRef.current({
          type: "openTab",
          initial: {
            filePath: opened.path,
            fileName: opened.fileName,
            originalText: opened.text,
            body: parsed.body,
            comments: parsed.comments,
            readOnly: opened.readOnly,
            // Seed the preferred view here rather than dispatching a
            // second action at the freshly created tab.
            viewMode: defaultViewRef.current,
          },
        });
        recordOpenedRef.current(opened.path, opened.fileName);
      } catch (err) {
        // Stale recent-file entry — surface a polite error and the
        // caller can decide to remove it from the recent list.
        logger("open path failed", err);
        dispatch({
          type: "error",
          message: `File no longer exists at ${path}. Remove from recent files?`,
        });
        // Tag the error message with the path so the recent-files UI
        // can decide whether to remove it. Custom events let the UI
        // act on the failure asynchronously.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("forgemark:open-failed", { detail: { path } }));
        }
      }
    },
    [dispatch, logger],
  );
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  // ⌘O. Each chosen file opens in its own tab.
  const runOpenDialog = useCallback(async () => {
    try {
      const files = await openMarkdownFiles();
      for (const opened of files) {
        let parsed;
        try {
          // Phase 9: tolerant mode keeps comments that are missing their
          // marker pair so the lost-anchor banner can surface them,
          // instead of dropping all comments on a single missing marker.
          parsed = parseForgemarkFile(opened.text, { tolerant: true });
        } catch (err) {
          // Fail soft: recover as many comments as possible (coalescing
          // splattered anchors, detaching unrecoverable ones for
          // reattachment) instead of dropping every comment.
          const recovery = recoverForgemarkFile(opened.text);
          parsed = recovery.file;
          dispatch({ type: "error", message: recoveryMessage(err, recovery) });
        }
        workspaceDispatchRef.current({
          type: "openTab",
          initial: {
            filePath: opened.path,
            fileName: opened.fileName,
            originalText: opened.text,
            body: parsed.body,
            comments: parsed.comments,
            readOnly: opened.readOnly,
            // Seed the preferred view here rather than dispatching a
            // second action at the freshly created tab.
            viewMode: defaultViewRef.current,
          },
        });
        recordOpenedRef.current(opened.path, opened.fileName);
      }
    } catch (err) {
      logger("open failed", err);
      dispatch({ type: "error", message: errorMessage("Open failed", err) });
    }
  }, [dispatch, logger]);

  // Listen for `forgemark:open-path` custom events from non-keyboard
  // surfaces (Open Recent menu, future native menu bar).
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      // Open Recent / Finder open in a tab, same as ⌘O.
      if (detail?.path) void openPathRef.current(detail.path);
    };
    window.addEventListener("forgemark:open-path", handler);
    return () => window.removeEventListener("forgemark:open-path", handler);
  }, [isActive]);

  // Save handler — shared by ⌘S and the pending-save effect (which
  // fires when the save-conflict modal's Overwrite is clicked).
  const performSave = useCallback(
    async (opts: { forcePrompt?: boolean } = {}) => {
      const s = stateRef.current;
      if (s.readOnly) return;
      const text = s.dirty
        ? serializeForgemarkFile({ body: s.body, comments: s.comments })
        : s.originalText;
      // Save As (⌘⇧S) forces the location prompt regardless of whether
      // the buffer already has a path; plain Save (⌘S) reuses the
      // path when set.
      const seedPath = opts.forcePrompt ? null : s.filePath;
      try {
        const path = await saveMarkdownFile(seedPath, text);
        if (!path) return; // user cancelled save dialog
        dispatch({ type: "saved", text, body: s.body });
        if (path !== s.filePath) {
          dispatch({
            type: "load",
            filePath: path,
            fileName: filenameFromPath(path),
            text,
            body: s.body,
            comments: s.comments,
            readOnly: false,
            // Path/filename rebind only — same buffer, so don't discard
            // the user's undo history.
            rebindOnly: true,
          });
        }
        // Refresh baseline so the watcher doesn't fire on our own write.
        baselineRef.current = await fingerprint(text, null);
      } catch (err) {
        logger("save failed", err);
        dispatch({ type: "error", message: errorMessage("Save failed", err) });
      }
    },
    [dispatch, logger],
  );

  // Quitting has to account for every open document, and each document's
  // file IO lives in its own bindings instance — this one can only save
  // its own. So the quit walks the tabs: find the first document with
  // unsaved work, hand focus to it so its instance takes over, and let
  // that instance re-enter here once it's dealt with. When nothing is
  // dirty anywhere, tell Rust it may exit.
  const runQuit = useCallback(async () => {
    const ws = workspaceRef.current;
    const dirtyId = ws.order.find((docId) => ws.docs[docId].dirty);

    if (!dirtyId) {
      try {
        await invoke("approve_exit");
      } catch (err) {
        logger("approve exit failed", err);
      }
      return;
    }

    if (dirtyId !== ws.activeId) {
      // Bring the unsaved document forward — prompting about a document
      // the user can't see would be baffling — then re-emit so the newly
      // active instance picks the quit up.
      workspaceDispatchRef.current({ type: "activateTab", docId: dirtyId });
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("forgemark:close-requested"));
      }, 0);
      return;
    }

    await guardDiscardRef.current({ kind: "quit" });
  }, [logger]);

  // Carry out an intent once nothing is standing in its way.
  const executeIntent = useCallback(
    async (intent: PendingIntent) => {
      if (intent.kind === "closeTab") {
        workspaceDispatchRef.current({ type: "closeTab", docId: intent.docId });
        return;
      }
      // Quit: loop back so the next unsaved document gets its turn.
      await runQuit();
    },
    [runQuit],
  );

  // Rust intercepts window-close and ⌘Q and defers to us, so quitting
  // gets the same unsaved-work guard as ⌘N/⌘O instead of relying on
  // beforeunload, which Tauri doesn't reliably honour.
  useEffect(() => {
    if (!isActive) return;
    const onCloseRequested = () => void runQuitRef.current();
    window.addEventListener("forgemark:close-requested", onCloseRequested);
    return () => window.removeEventListener("forgemark:close-requested", onCloseRequested);
  }, [isActive]);
  const runQuitRef = useRef(runQuit);
  runQuitRef.current = runQuit;

  // ⌘N and ⌘O throw away the current buffer. Before this guard they did
  // it silently, which was survivable only because auto-save had usually
  // just written the file — but auto-save is skipped for Untitled
  // documents and while a conflict is pending, and in exactly those two
  // cases the work was gone with no prompt.
  //
  // Forgemark is an auto-save-first app, so prompting to save something
  // auto-save would have written 500ms later would be incoherent. The
  // rule is therefore: if we *can* save it for the user, do that and
  // carry on. Only ask when we can't.
  const guardDiscard = useCallback(
    async (intent: PendingIntent) => {
      const s = stateRef.current;
      if (!s.dirty || s.readOnly) {
        await executeIntent(intent);
        return;
      }
      // Untitled needs a destination from the user, and saving during an
      // unresolved conflict would clobber the disk copy. Both have to ask.
      const canSaveSilently = s.filePath != null && s.externalChange == null;
      if (canSaveSilently) {
        await performSave();
        await executeIntent(intent);
        return;
      }
      dispatch({ type: "requestIntent", intent });
    },
    [dispatch, executeIntent, performSave],
  );
  guardDiscardRef.current = guardDiscard;

  // The user answered the unsaved-changes prompt. "save" routes through
  // the normal save path (which prompts for a location when Untitled) and
  // only proceeds if that succeeded — cancelling the save dialog must
  // cancel the whole action rather than silently discarding.
  useEffect(() => {
    const resolution = state.intentResolution;
    const intent = state.pendingIntent;
    if (!resolution || !intent) return;
    let cancelled = false;
    (async () => {
      if (resolution === "save") {
        await performSave();
        // performSave leaves `dirty` set if the user backed out of the
        // location dialog or the write failed. Don't discard their work.
        if (stateRef.current.dirty) {
          if (!cancelled) dispatch({ type: "clearIntent" });
          return;
        }
      } else if (intent.kind === "quit") {
        // "Don't Save" during a quit. The document stays dirty, so the
        // quit walk would find it again and ask about it forever — drop
        // the tab instead. We're exiting anyway, and removing it is what
        // lets the walk move on to the next unsaved document.
        workspaceDispatchRef.current({ type: "closeTab", docId: idRef.current });
        if (!cancelled) dispatch({ type: "clearIntent" });
        // Re-enter once the workspace has settled, rather than reading
        // stale state synchronously.
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("forgemark:close-requested"));
        }, 0);
        return;
      }
      if (cancelled) return;
      await executeIntent(intent);
      dispatch({ type: "clearIntent" });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.intentResolution, state.pendingIntent, dispatch, executeIntent, performSave]);

  // File > Close. Clears the document but keeps the window open
  // (TextEdit / Pages convention), so it discards the buffer and has to
  // clear the same guard as ⌘N.
  useEffect(() => {
    if (!isActive) return;
    const onMenu = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "close-file") return;
      void guardDiscardRef.current({ kind: "closeTab", docId: idRef.current });
    };
    window.addEventListener("forgemark:menu", onMenu);
    return () => window.removeEventListener("forgemark:menu", onMenu);
  }, [isActive]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!isActive) return;
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const s = stateRef.current;
      if (key === "o") {
        e.preventDefault();
        // Opens in a tab of its own — nothing is discarded, so no guard.
        await runOpenDialog();
      } else if (key === "s") {
        e.preventDefault();
        if (s.readOnly) return;
        // Phase 10: if there's a pending external change, route into
        // the save-conflict modal instead of overwriting silently.
        // (Save As also routes here — the conflict resolution comes
        // first.)
        if (s.externalChange != null) {
          dispatch({ type: "openSaveConflict" });
          return;
        }
        // ⌘S = save in place (or prompt for Untitled);
        // ⌘⇧S = Save As, always prompts.
        await performSave({ forcePrompt: e.shiftKey });
      } else if (key === "n") {
        e.preventDefault();
        workspaceDispatchRef.current({ type: "openTab" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, performSave, runOpenDialog, isActive]);

  // ── Auto-save (500ms quiet period after last edit) ──
  // Phase 10: skip auto-save while there's an externalChange pending.
  // The user gets to decide explicitly via the conflict surfaces.
  useEffect(() => {
    if (!state.dirty) return;
    if (!state.filePath) return;
    if (state.readOnly) return;
    if (state.externalChange != null) return;
    const handle = setTimeout(async () => {
      const text = serializeForgemarkFile({ body: state.body, comments: state.comments });
      try {
        await saveMarkdownFile(state.filePath, text);
        dispatch({ type: "saved", text, body: state.body });
        baselineRef.current = await fingerprint(text, null);
      } catch (err) {
        logger("auto-save failed", err);
        dispatch({ type: "error", message: errorMessage("Auto-save failed", err) });
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [
    state.dirty,
    state.body,
    state.comments,
    state.filePath,
    state.readOnly,
    state.externalChange,
    dispatch,
    logger,
  ]);

  // Phase 10: pendingSave bridge. When the save-conflict modal's
  // Overwrite is clicked, AppShell dispatches `requestSave`. We pick
  // it up here, run the save, and clear the flag.
  useEffect(() => {
    if (!state.pendingSave) return;
    let cancelled = false;
    (async () => {
      await performSave();
      if (!cancelled) dispatch({ type: "clearPendingSave" });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.pendingSave, performSave, dispatch]);

  // Fallback for the plain-browser dev surface (`npm run vite:dev`),
  // where there's no Tauri runtime to intercept the close. In the real
  // app the Rust CloseRequested/ExitRequested handlers get there first
  // and route through guardDiscard, which is the path that can actually
  // offer to save.
  useEffect(() => {
    if (!isActive) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!anyDirty(workspaceRef.current)) return;
      e.preventDefault();
      // Modern browsers ignore the string but require an assignment.
      e.returnValue = "You have unsaved changes.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActive]);

  // Phase 10: watch the open file for external changes. The watcher
  // wrapper compares against baselineRef so writes we just did don't
  // re-fire as conflicts.
  useEffect(() => {
    const path = state.filePath;
    if (!path) return;
    let watcher: FileWatcher | null = null;
    let cancelled = false;
    (async () => {
      try {
        const w = await watchMarkdownFile(
          path,
          () => baselineRef.current,
          ({ text, fingerprint: fp }) => {
            // Try to parse the new bytes. If parse fails, surface the
            // change with parseError set so the save-conflict modal
            // can show "Unknown changes".
            try {
              const parsed = parseForgemarkFile(text, { tolerant: true });
              dispatch({
                type: "externalChangeDetected",
                text,
                body: parsed.body,
                comments: parsed.comments,
                fingerprint: fp,
              });
            } catch (err) {
              dispatch({
                type: "externalChangeDetected",
                text,
                body: text,
                comments: [],
                fingerprint: fp,
                parseError: (err as Error).message,
              });
            }
          },
        );
        if (cancelled) {
          await w.dispose();
          return;
        }
        watcher = w;
      } catch (err) {
        // The watcher is best-effort. If it can't start, don't break
        // the rest of the app — just log.
        logger("watcher start failed", err);
      }
    })();
    return () => {
      cancelled = true;
      void watcher?.dispose();
    };
  }, [state.filePath, dispatch, logger]);

  return null;
}

function filenameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
