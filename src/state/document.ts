// Document model.
//
// Phase 2: a single open file (or none). Holds the bytes-as-loaded
// (`originalText`) so a no-edits save round-trips byte-equivalent, plus
// the editor-driven `body` text that becomes the canonical bytes once
// the user edits.
//
// Phase 3 added the format layer (parser/serializer for the comments
// block).
//
// Phase 4: state now also holds the parsed `comments` array, the body
// with the trailing comments block stripped (`body`), and per-document
// UI state for anchor focus/hover that sidebars and the editor share.

import type { Comment } from "../format/types";

export type DocumentState = {
  // Absolute path on disk. null when no file is open or when the user has
  // started a fresh "Untitled" buffer.
  filePath: string | null;
  // Display name in the title bar. "Untitled" when filePath is null.
  fileName: string;
  // Bytes as last read from / written to disk. Used to write back unchanged
  // when the session has no edits, and shown verbatim in source view.
  originalText: string;
  // Body of the document with the trailing forgemark-comments block
  // stripped. Inline marker comments (`<!-- fmc:N -->...<!-- /fmc:N -->`)
  // are still present in this string — they're load-bearing for the
  // anchor decorations and the round-trip serializer.
  body: string;
  // Parsed comment records. Empty array for files with no comments block.
  comments: Comment[];
  // True when the editor has been edited since the last load or save.
  dirty: boolean;
  // Per-document view mode. Resets on file open per design.
  viewMode: "rendered" | "source";
  // True when the open file is read-only on disk.
  readOnly: boolean;
  // Last user-facing error (file open / save). Cleared when the user
  // dismisses the banner, opens a different file, or saves successfully.
  error: string | null;
  // Per-document UI state for anchor / card interaction. Both editor and
  // sidebar read these to drive the highlight and card states. Phase 4
  // wires click-to-focus and hover-symmetry; later phases reuse them.
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
};

export const INITIAL_STATE: DocumentState = {
  filePath: null,
  fileName: "Untitled",
  originalText: "",
  body: "",
  comments: [],
  dirty: false,
  viewMode: "rendered",
  readOnly: false,
  error: null,
  focusedCommentId: null,
  hoveredCommentId: null,
};

export type DocumentAction =
  | {
      type: "load";
      filePath: string;
      fileName: string;
      text: string;
      body: string;
      comments: Comment[];
      readOnly: boolean;
    }
  | { type: "edit"; body: string }
  | { type: "saved"; text: string; body: string }
  | { type: "setViewMode"; viewMode: "rendered" | "source" }
  | { type: "newUntitled" }
  | { type: "error"; message: string }
  | { type: "dismissError" }
  | { type: "setFocusedComment"; id: number | null }
  | { type: "setHoveredComment"; id: number | null };

export function reduceDocument(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case "load":
      return {
        filePath: action.filePath,
        fileName: action.fileName,
        originalText: action.text,
        body: action.body,
        comments: action.comments,
        dirty: false,
        viewMode: "rendered",
        readOnly: action.readOnly,
        error: null,
        focusedCommentId: null,
        hoveredCommentId: null,
      };
    case "edit":
      // No-op if the body hasn't actually changed (Tiptap can fire updates
      // for cursor moves in some configurations). Treat that as clean.
      if (action.body === state.body) return state;
      return {
        ...state,
        body: action.body,
        dirty: true,
      };
    case "saved":
      return {
        ...state,
        originalText: action.text,
        body: action.body,
        dirty: false,
        error: null,
      };
    case "setViewMode":
      return { ...state, viewMode: action.viewMode };
    case "newUntitled":
      return { ...INITIAL_STATE };
    case "error":
      return { ...state, error: action.message };
    case "dismissError":
      return { ...state, error: null };
    case "setFocusedComment":
      if (state.focusedCommentId === action.id) return state;
      return { ...state, focusedCommentId: action.id };
    case "setHoveredComment":
      if (state.hoveredCommentId === action.id) return state;
      return { ...state, hoveredCommentId: action.id };
    default:
      return state;
  }
}
