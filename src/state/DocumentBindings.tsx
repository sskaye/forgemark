import { useCallback, useEffect, useRef } from "react";
import { useDocument } from "./DocumentProvider";
import { openMarkdownFile, saveMarkdownFile } from "../services/fileIO";
import { parseForgemarkFile, serializeForgemarkFile, ForgemarkParseError } from "../format";
import { fingerprint, type FileFingerprint } from "../services/conflict";
import { watchMarkdownFile, type FileWatcher } from "../services/fileWatcher";

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
  const { state, dispatch } = useDocument();

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
  }, [dispatch, logger, performSave]);

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
