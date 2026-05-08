import { useCallback, useEffect, useRef } from "react";
import { useDocument } from "./DocumentProvider";
import { openMarkdownFile, saveMarkdownFile, readMarkdownFile } from "../services/fileIO";
import { parseForgemarkFile, serializeForgemarkFile, ForgemarkParseError } from "../format";
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

// Phase 2 ergonomic bindings — live until Phase 11 wires the native menu
// bar. Renders nothing.
//
//   ⌘O / Ctrl+O — open file dialog
//   ⌘S / Ctrl+S — save (dirty: write body; clean: write original bytes)
//   ⌘N / Ctrl+N — new untitled buffer (discards current; warning prompt
//                  is Phase 11's save-on-close work, deferred for now)
//
// Auto-save: when a file path is set and the document is dirty, schedules
// a save 500ms after the last edit. Untitled buffers never auto-save —
// the user must ⌘S to choose a destination.
export function DocumentBindings({ logger = defaultLogger }: { logger?: Logger }) {
  const { state, dispatch, setViewMode } = useDocument();
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
          const msg =
            err instanceof ForgemarkParseError
              ? `Comments block couldn't be parsed (${err.kind}); loaded as plain markdown.`
              : `Couldn't parse comment block: ${(err as Error).message}`;
          dispatch({ type: "error", message: msg });
          parsed = { body: opened.text, comments: [] };
        }
        dispatch({
          type: "load",
          filePath: opened.path,
          fileName: opened.fileName,
          text: opened.text,
          body: parsed.body,
          comments: parsed.comments,
          readOnly: opened.readOnly,
        });
        recordOpenedRef.current(opened.path, opened.fileName);
        if (defaultViewRef.current !== "rendered") {
          setViewMode(defaultViewRef.current);
        }
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
    [dispatch, setViewMode, logger],
  );

  // Listen for `forgemark:open-path` custom events from non-keyboard
  // surfaces (Open Recent menu, future native menu bar).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      if (detail?.path) void openPath(detail.path);
    };
    window.addEventListener("forgemark:open-path", handler);
    return () => window.removeEventListener("forgemark:open-path", handler);
  }, [openPath]);

  // Save handler — shared by ⌘S and the pending-save effect (which
  // fires when the save-conflict modal's Overwrite is clicked).
  const performSave = useCallback(async () => {
    const s = stateRef.current;
    if (s.readOnly) return;
    const text = s.dirty
      ? serializeForgemarkFile({ body: s.body, comments: s.comments })
      : s.originalText;
    try {
      const path = await saveMarkdownFile(s.filePath, text);
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
        });
      }
      // Refresh baseline so the watcher doesn't fire on our own write.
      baselineRef.current = await fingerprint(text, null);
    } catch (err) {
      logger("save failed", err);
      dispatch({ type: "error", message: errorMessage("Save failed", err) });
    }
  }, [dispatch, logger]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const s = stateRef.current;
      if (key === "o") {
        e.preventDefault();
        try {
          const opened = await openMarkdownFile();
          if (!opened) return;
          let parsed;
          try {
            // Phase 9: tolerant mode keeps comments that are missing
            // their marker pair so the lost-anchor banner can surface
            // them (instead of dropping all comments on a single
            // missing-marker case).
            parsed = parseForgemarkFile(opened.text, { tolerant: true });
          } catch (err) {
            // Helpful "couldn't parse the comment block" surfacing — the
            // caller still gets the body, just without comments. We treat
            // a malformed comment block as a soft failure: surface an
            // error banner and load the file as plain markdown.
            const msg =
              err instanceof ForgemarkParseError
                ? `Comments block couldn't be parsed (${err.kind}); loaded as plain markdown.`
                : `Couldn't parse comment block: ${(err as Error).message}`;
            dispatch({ type: "error", message: msg });
            parsed = { body: opened.text, comments: [] };
          }
          dispatch({
            type: "load",
            filePath: opened.path,
            fileName: opened.fileName,
            text: opened.text,
            body: parsed.body,
            comments: parsed.comments,
            readOnly: opened.readOnly,
          });
          recordOpenedRef.current(opened.path, opened.fileName);
          // Phase 11 default-view preference: applied on the next
          // opened document, per design handoff §9.
          if (defaultViewRef.current !== "rendered") {
            setViewMode(defaultViewRef.current);
          }
        } catch (err) {
          logger("open failed", err);
          dispatch({ type: "error", message: errorMessage("Open failed", err) });
        }
      } else if (key === "s") {
        e.preventDefault();
        if (s.readOnly) return;
        // Phase 10: if there's a pending external change, route into
        // the save-conflict modal instead of overwriting silently.
        if (s.externalChange != null) {
          dispatch({ type: "openSaveConflict" });
          return;
        }
        await performSave();
      } else if (key === "n") {
        e.preventDefault();
        dispatch({ type: "newUntitled" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, logger, performSave, setViewMode]);

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

  // Phase 11 save-on-close: block window close while there's unsaved
  // work. The browser shows its own confirmation dialog when
  // beforeunload's returnValue is set; the native Tauri close event
  // (which the OS surfaces as a "Do you want to save…" sheet) will be
  // wired up alongside the menu bar in a Phase 11 follow-up.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!state.dirty) return;
      e.preventDefault();
      // Modern browsers ignore the string but require an assignment.
      e.returnValue = "You have unsaved changes.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.dirty]);

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
