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
//
// Phase 5 added the new-comment composer surface.
//
// Phase 6 expands the composer to a tagged union (new / reply /
// editComment / editReply) and adds reducer cases for replies, edits,
// resolve toggling, deletion, and sidebar filter / sort.

import type { Comment, Reply } from "../format/types";

export type DocumentState = {
  filePath: string | null;
  fileName: string;
  originalText: string;
  body: string;
  comments: Comment[];
  dirty: boolean;
  viewMode: "rendered" | "source";
  readOnly: boolean;
  error: string | null;
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  composer: ComposerState | null;
  // Sidebar UI controls (Phase 6). Persist within a session; reset on
  // file open.
  filter: FilterMode;
  sort: SortMode;
};

// Composer state. Tagged-union by mode:
//
//  - "new":         the new-comment composer floats beside the captured
//                   selection in the editor pane (Phase 5).
//  - "reply":       inline reply composer nested under the focused card.
//  - "editComment": replaces the body of the focused card with an
//                   editable textarea pre-populated with the original
//                   body. Only the comment's author can open this.
//  - "editReply":   same but for a specific reply within a thread.
//
// At most one composer is open at a time; the reducer enforces this by
// replacing whatever is currently set.
export type ComposerState =
  | NewComposerState
  | ReplyComposerState
  | EditCommentComposerState
  | EditReplyComposerState;

export type NewComposerState = {
  mode: "new";
  from: number;
  to: number;
  selectionText: string;
  contextBefore: string;
  contextAfter: string;
  x: number;
  y: number;
};

export type ReplyComposerState = {
  mode: "reply";
  commentId: number;
};

export type EditCommentComposerState = {
  mode: "editComment";
  commentId: number;
  initialBody: string;
};

export type EditReplyComposerState = {
  mode: "editReply";
  commentId: number;
  replyIndex: number;
  initialBody: string;
};

export type SortMode = "doc" | "newest" | "oldest";
export type FilterMode =
  | { kind: "all" }
  | { kind: "open" }
  | { kind: "resolved" }
  | { kind: "byMe" }
  | { kind: "byAuthor"; author: string };

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
  composer: null,
  filter: { kind: "all" },
  sort: "doc",
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
  | { type: "setHoveredComment"; id: number | null }
  | { type: "openComposer"; composer: ComposerState }
  | { type: "closeComposer" }
  | { type: "addComment"; comment: Comment; body: string }
  | { type: "addReply"; commentId: number; reply: Reply }
  | { type: "editComment"; commentId: number; body: string; editedAt: string }
  | {
      type: "editReply";
      commentId: number;
      replyIndex: number;
      body: string;
      editedAt: string;
    }
  | { type: "toggleResolved"; commentId: number }
  | { type: "deleteComment"; commentId: number; body: string }
  | { type: "deleteReply"; commentId: number; replyIndex: number }
  | { type: "acceptSuggestion"; commentId: number; body: string }
  | { type: "rejectSuggestion"; commentId: number; body: string }
  | { type: "setFilter"; filter: FilterMode }
  | { type: "setSort"; sort: SortMode };

export function reduceDocument(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case "load":
      return {
        ...state,
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
        composer: null,
        // Filter / sort persist across loads — they're a viewing
        // preference, not a document property.
      };
    case "edit":
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
      return { ...INITIAL_STATE, filter: state.filter, sort: state.sort };
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
    case "openComposer":
      return { ...state, composer: action.composer };
    case "closeComposer":
      return { ...state, composer: null };
    case "addComment":
      return {
        ...state,
        body: action.body,
        comments: [...state.comments, action.comment].sort((a, b) => a.id - b.id),
        dirty: true,
        composer: null,
        focusedCommentId: action.comment.id,
        error: null,
      };
    case "addReply": {
      const comments = state.comments.map((c) =>
        c.id === action.commentId ? { ...c, replies: [...(c.replies ?? []), action.reply] } : c,
      );
      return {
        ...state,
        comments,
        dirty: true,
        composer: null,
        focusedCommentId: action.commentId,
        error: null,
      };
    }
    case "editComment": {
      const comments = state.comments.map((c) =>
        c.id === action.commentId ? { ...c, body: action.body, edited_at: action.editedAt } : c,
      );
      return {
        ...state,
        comments,
        dirty: true,
        composer: null,
        error: null,
      };
    }
    case "editReply": {
      const comments = state.comments.map((c) => {
        if (c.id !== action.commentId) return c;
        const replies = (c.replies ?? []).map((r, i) =>
          i === action.replyIndex ? { ...r, body: action.body, edited_at: action.editedAt } : r,
        );
        return { ...c, replies };
      });
      return {
        ...state,
        comments,
        dirty: true,
        composer: null,
        error: null,
      };
    }
    case "toggleResolved": {
      const comments = state.comments.map((c) =>
        c.id === action.commentId ? { ...c, resolved: !c.resolved } : c,
      );
      return { ...state, comments, dirty: true };
    }
    case "deleteComment":
      return {
        ...state,
        body: action.body,
        comments: state.comments.filter((c) => c.id !== action.commentId),
        dirty: true,
        focusedCommentId:
          state.focusedCommentId === action.commentId ? null : state.focusedCommentId,
        composer: null,
      };
    case "deleteReply": {
      const comments = state.comments.map((c) => {
        if (c.id !== action.commentId) return c;
        const replies = (c.replies ?? []).filter((_, i) => i !== action.replyIndex);
        return { ...c, replies };
      });
      return { ...state, comments, dirty: true, composer: null };
    }
    case "acceptSuggestion":
    case "rejectSuggestion":
      // Both terminal (per proposal §117): remove the comment and update
      // the body. Caller computed the new body — accept replaces the
      // anchored text with `to`; reject leaves the anchored text in place
      // and just strips the markers.
      return {
        ...state,
        body: action.body,
        comments: state.comments.filter((c) => c.id !== action.commentId),
        dirty: true,
        focusedCommentId:
          state.focusedCommentId === action.commentId ? null : state.focusedCommentId,
        composer: null,
      };
    case "setFilter":
      return { ...state, filter: action.filter };
    case "setSort":
      return { ...state, sort: action.sort };
    default:
      return state;
  }
}
