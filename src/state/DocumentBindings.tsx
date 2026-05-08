import { useEffect, useRef } from "react";
import { useDocument } from "./DocumentProvider";
import { openMarkdownFile, saveMarkdownFile } from "../services/fileIO";

type Logger = (msg: string, err: unknown) => void;

const defaultLogger: Logger = (msg, err) => {
  console.error("[forgemark] " + msg, err);
};

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
          dispatch({
            type: "load",
            filePath: opened.path,
            fileName: opened.fileName,
            text: opened.text,
            readOnly: opened.readOnly,
          });
        } catch (err) {
          logger("open failed", err);
        }
      } else if (key === "s") {
        e.preventDefault();
        if (s.readOnly) return;
        const text = s.dirty ? s.body : s.originalText;
        try {
          const path = await saveMarkdownFile(s.filePath, text);
          if (!path) return; // user cancelled save dialog
          dispatch({ type: "saved", text });
          if (path !== s.filePath) {
            // Save-as for an Untitled buffer; reload to update path/name.
            // For now we just record the path; Phase 11 polishes this.
            dispatch({
              type: "load",
              filePath: path,
              fileName: filenameFromPath(path),
              text,
              readOnly: false,
            });
          }
        } catch (err) {
          logger("save failed", err);
        }
      } else if (key === "n") {
        e.preventDefault();
        dispatch({ type: "newUntitled" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, logger]);

  // ── Auto-save (500ms quiet period after last edit) ──
  useEffect(() => {
    if (!state.dirty) return;
    if (!state.filePath) return;
    if (state.readOnly) return;
    const handle = setTimeout(async () => {
      try {
        await saveMarkdownFile(state.filePath, state.body);
        dispatch({ type: "saved", text: state.body });
      } catch (err) {
        logger("auto-save failed", err);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [state.dirty, state.body, state.filePath, state.readOnly, dispatch, logger]);

  return null;
}

function filenameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
