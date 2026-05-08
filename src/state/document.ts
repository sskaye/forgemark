// Document model.
//
// Phase 2: a single open file (or none). Holds the bytes-as-loaded
// (`originalText`) so a no-edits save round-trips byte-equivalent, plus
// the editor-driven `body` text that becomes the canonical bytes once the
// user edits.
//
// Phase 3 will replace the body string with a `{ proseDoc, comments[] }`
// structured form, but the surface of this module is stable.

export type DocumentState = {
  // Absolute path on disk. null when no file is open or when the user has
  // started a fresh "Untitled" buffer.
  filePath: string | null;
  // Display name in the title bar. "Untitled" when filePath is null.
  fileName: string;
  // Bytes as last read from / written to disk. Used to write back unchanged
  // when the session has no edits.
  originalText: string;
  // Live body text. Equal to originalText until the user edits.
  body: string;
  // True when the editor has been edited since the last load or save.
  dirty: boolean;
  // Per-document view mode. Resets on file open per design.
  viewMode: "rendered" | "source";
  // True when the open file is read-only on disk.
  readOnly: boolean;
};

export const INITIAL_STATE: DocumentState = {
  filePath: null,
  fileName: "Untitled",
  originalText: "",
  body: "",
  dirty: false,
  viewMode: "rendered",
  readOnly: false,
};

export type DocumentAction =
  | {
      type: "load";
      filePath: string;
      fileName: string;
      text: string;
      readOnly: boolean;
    }
  | { type: "edit"; body: string }
  | { type: "saved"; text: string }
  | { type: "setViewMode"; viewMode: "rendered" | "source" }
  | { type: "newUntitled" };

export function reduceDocument(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case "load":
      return {
        filePath: action.filePath,
        fileName: action.fileName,
        originalText: action.text,
        body: action.text,
        dirty: false,
        viewMode: "rendered",
        readOnly: action.readOnly,
      };
    case "edit":
      // No-op if the body hasn't actually changed (Tiptap can fire updates
      // for cursor moves in some configurations). Treat that as clean.
      if (action.body === state.body) return state;
      return {
        ...state,
        body: action.body,
        dirty: action.body !== state.originalText,
      };
    case "saved":
      return {
        ...state,
        originalText: action.text,
        body: action.text,
        dirty: false,
      };
    case "setViewMode":
      return { ...state, viewMode: action.viewMode };
    case "newUntitled":
      return { ...INITIAL_STATE };
    default:
      return state;
  }
}
