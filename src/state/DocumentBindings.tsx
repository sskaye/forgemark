import { useEffect, useRef } from "react";
import { useDocument } from "./DocumentProvider";
import { openMarkdownFile, saveMarkdownFile } from "../services/fileIO";
import { parseForgemarkFile, serializeForgemarkFile, ForgemarkParseError } from "../format";

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
            parsed = parseForgemarkFile(opened.text);
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
        // Compose the bytes to write. If clean, write the bytes as loaded
        // (byte-identical). If dirty, serialize the current body + comments
        // through the format serializer (round-trip parity guaranteed).
        const text = s.dirty
          ? serializeForgemarkFile({ body: s.body, comments: s.comments })
          : s.originalText;
        try {
          const path = await saveMarkdownFile(s.filePath, text);
          if (!path) return; // user cancelled save dialog
          dispatch({ type: "saved", text, body: s.body });
          if (path !== s.filePath) {
            // Save-as for an Untitled buffer; reload to update path/name.
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
        } catch (err) {
          logger("save failed", err);
          dispatch({ type: "error", message: errorMessage("Save failed", err) });
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
      const text = serializeForgemarkFile({ body: state.body, comments: state.comments });
      try {
        await saveMarkdownFile(state.filePath, text);
        dispatch({ type: "saved", text, body: state.body });
      } catch (err) {
        logger("auto-save failed", err);
        dispatch({ type: "error", message: errorMessage("Auto-save failed", err) });
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [state.dirty, state.body, state.comments, state.filePath, state.readOnly, dispatch, logger]);

  return null;
}

function filenameFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
