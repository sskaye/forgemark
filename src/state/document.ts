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
import type { FileFingerprint } from "../services/conflict";

export type DocumentState = {
  filePath: string | null;
  fileName: string;
  originalText: string;
  body: string;
  comments: Comment[];
  dirty: boolean;
  // Bumped whenever `body` is replaced by something other than a user
  // keystroke — opening a file, or reloading it from disk. The rendered
  // editor keys off this to force a genuine remount, which is what
  // discards the Tiptap/ProseMirror undo stack. Without it the undo
  // history outlives the content it belongs to and ⌘Z walks backwards
  // into the *previous* document. Save As is deliberately excluded (see
  // `rebindOnly` on the `load` action).
  loadGeneration: number;
  viewMode: "rendered" | "source";
  readOnly: boolean;
  error: string | null;
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  composer: ComposerState | null;
  // Phase 9: which orphaned comment, if any, is being reattached. The
  // modal renders against the comment with this id. Reset on file open.
  reattachTarget: number | null;
  // Phase 10: a pending external change detected by the file watcher.
  // null when the in-memory state is in sync with the disk (or the
  // user has explicitly chosen to keep their version).
  externalChange: ExternalChange | null;
  // Phase 10: true while the save-conflict modal is open (set by
  // DocumentBindings when ⌘S is pressed and externalChange != null).
  saveConflictOpen: boolean;
  // Phase 10: tracks whether the user has cancelled the
  // edit-during-open modal for the *current* externalChange. Reset
  // when a new externalChange is detected. Without this, every
  // re-render would re-open the modal.
  editDuringOpenDismissed: boolean;
  // Phase 10: a one-shot request to run save logic. The save-conflict
  // modal sets this when the user picks Overwrite — DocumentBindings
  // is the only thing with file-IO services, so the request travels
  // through state to reach it.
  pendingSave: boolean;
  // Sidebar UI controls (Phase 6). Persist within a session; reset on
  // file open.
  filter: FilterMode;
  sort: SortMode;
  // An action that would discard unsaved work, parked while we ask the
  // user what to do. Only set when the work *can't* just be saved for
  // them — see `guardDiscard` in DocumentBindings.
  pendingIntent: PendingIntent | null;
  // The user's answer. Kept separate from `pendingIntent` so the
  // executing effect knows both what to do and what was asked; cleared
  // together via `clearIntent`.
  intentResolution: "save" | "discard" | null;
};

// Something the user asked for that throws away the current buffer.
export type PendingIntent =
  | { kind: "newUntitled" }
  | { kind: "openDialog" }
  | { kind: "openPath"; path: string }
  // Window close or ⌘Q. Rust has blocked the exit and is waiting to be
  // told it may proceed.
  | { kind: "quit" };

// Phase 10: the disk content that conflicts with the in-memory state.
// Held verbatim so "Reload from disk" can replace the state, and parsed
// alongside so the diff strip in the save-conflict modal can compare
// comments and body.
export type ExternalChange = {
  text: string;
  body: string;
  comments: Comment[];
  fingerprint: FileFingerprint;
  // Set when the disk bytes failed to parse — drives the "Unknown
  // changes" fallback in the save-conflict modal.
  parseError?: string;
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
  | OverlapPromptComposerState
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
  // Optional initial composer mode. Defaults to "comment". The
  // right-click context menu's "Suggest edit" path sets this to
  // "suggest" so the composer opens with the toggle pre-engaged.
  initialMode?: "comment" | "suggest";
};

// Shown instead of the new-comment composer when the user's selection
// overlaps an existing comment's anchor. The file format can't represent
// overlapping anchors, so we offer to attach the note as a reply to the
// existing comment (targetCommentId) instead. Floats beside the selection
// like the new-comment composer.
export type OverlapPromptComposerState = {
  mode: "overlapPrompt";
  targetCommentId: number;
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
  loadGeneration: 0,
  viewMode: "rendered",
  readOnly: false,
  error: null,
  focusedCommentId: null,
  hoveredCommentId: null,
  composer: null,
  reattachTarget: null,
  externalChange: null,
  saveConflictOpen: false,
  editDuringOpenDismissed: false,
  pendingSave: false,
  filter: { kind: "all" },
  sort: "doc",
  pendingIntent: null,
  intentResolution: null,
};

export type DocumentAction =
  | {
      type: "load";
      // null when loading an in-memory document (e.g. the bundled
      // sample file at first run) — the user picks a path on first ⌘S.
      filePath: string | null;
      fileName: string;
      text: string;
      body: string;
      comments: Comment[];
      readOnly: boolean;
      // Save As re-dispatches `load` purely to rebind path/filename —
      // the content is the same buffer the user has been editing, so
      // their undo history must survive. Set this to keep
      // `loadGeneration` (and therefore the editor instance) stable.
      rebindOnly?: boolean;
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
  | {
      type: "reattachComment";
      commentId: number;
      body: string;
      anchor_text: string;
      context_before: string;
      context_after: string;
    }
  | { type: "convertToFloating"; commentId: number; body: string }
  | { type: "openReattach"; commentId: number }
  | { type: "closeReattach" }
  | {
      type: "externalChangeDetected";
      text: string;
      body: string;
      comments: Comment[];
      fingerprint: FileFingerprint;
      parseError?: string;
    }
  | { type: "dismissExternalChange" }
  | { type: "applyExternalChange" }
  | { type: "openSaveConflict" }
  | { type: "dismissSaveConflict" }
  | { type: "dismissEditDuringOpen" }
  | { type: "requestSave" }
  | { type: "clearPendingSave" }
  | { type: "setFilter"; filter: FilterMode }
  | { type: "setSort"; sort: SortMode }
  | { type: "requestIntent"; intent: PendingIntent }
  | { type: "resolveIntent"; resolution: "save" | "discard" }
  | { type: "clearIntent" };

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
        loadGeneration: action.rebindOnly ? state.loadGeneration : state.loadGeneration + 1,
        viewMode: "rendered",
        readOnly: action.readOnly,
        error: null,
        focusedCommentId: null,
        hoveredCommentId: null,
        composer: null,
        reattachTarget: null,
        externalChange: null,
        saveConflictOpen: false,
        editDuringOpenDismissed: false,
        pendingSave: false,
        // A load is the completion of whatever intent was parked (or a
        // load from an unrelated surface). Either way nothing is waiting
        // on the user any more.
        pendingIntent: null,
        intentResolution: null,
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
        pendingSave: false,
      };
    case "setViewMode":
      return { ...state, viewMode: action.viewMode };
    case "requestIntent":
      return { ...state, pendingIntent: action.intent, intentResolution: null };
    case "resolveIntent":
      if (!state.pendingIntent) return state;
      return { ...state, intentResolution: action.resolution };
    case "clearIntent":
      if (!state.pendingIntent && !state.intentResolution) return state;
      return { ...state, pendingIntent: null, intentResolution: null };
    case "newUntitled":
      return {
        ...INITIAL_STATE,
        filter: state.filter,
        sort: state.sort,
        // Must keep climbing, not reset to INITIAL_STATE's 0 — otherwise
        // ⌘N out of a never-loaded Untitled buffer (generation still 0)
        // wouldn't change the key, and the discarded document's undo
        // stack would survive into the new one.
        loadGeneration: state.loadGeneration + 1,
      };
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
      const target = state.comments.find((c) => c.id === action.commentId);
      const willBeResolved = !(target?.resolved ?? false);
      const comments = state.comments.map((c) =>
        c.id === action.commentId ? { ...c, resolved: !c.resolved } : c,
      );
      // Becoming resolved should immediately collapse the card. The
      // showCollapsed predicate in FMCard requires `!focused`, so
      // unfocus the card on the resolve transition. Re-opening
      // (resolved → unresolved) keeps focus.
      const focusedCommentId =
        willBeResolved && state.focusedCommentId === action.commentId
          ? null
          : state.focusedCommentId;
      return { ...state, comments, dirty: true, focusedCommentId };
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
        reattachTarget: state.reattachTarget === action.commentId ? null : state.reattachTarget,
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
    case "reattachComment": {
      const comments = state.comments.map((c) =>
        c.id === action.commentId
          ? {
              ...c,
              floating: undefined,
              anchor_text: action.anchor_text,
              context_before: action.context_before,
              context_after: action.context_after,
            }
          : c,
      );
      return {
        ...state,
        body: action.body,
        comments,
        dirty: true,
        composer: null,
        reattachTarget: null,
        error: null,
      };
    }
    case "convertToFloating": {
      const comments = state.comments.map((c) => {
        if (c.id !== action.commentId) return c;
        // Drop anchor metadata along with floating: true. Per
        // SKILL.md the anchor fields are *optionally* cleared; we
        // clear them to keep round-tripped YAML free of stale state.
        const next: typeof c = {
          ...c,
          floating: true,
          anchor_text: undefined,
          context_before: undefined,
          context_after: undefined,
        };
        return next;
      });
      return {
        ...state,
        body: action.body,
        comments,
        dirty: true,
        composer: null,
        reattachTarget: null,
        error: null,
      };
    }
    case "openReattach":
      return { ...state, reattachTarget: action.commentId };
    case "closeReattach":
      return { ...state, reattachTarget: null };
    case "externalChangeDetected":
      return {
        ...state,
        externalChange: {
          text: action.text,
          body: action.body,
          comments: action.comments,
          fingerprint: action.fingerprint,
          parseError: action.parseError,
        },
        // A new conflict resets the dismiss bit — if the user had
        // already cancelled the modal for an *older* externalChange,
        // we still want them to see this fresh one.
        editDuringOpenDismissed: false,
      };
    case "dismissExternalChange":
      // "Keep your version" — drop the disk content from state. The
      // user has chosen their bytes. ⌘S will overwrite normally.
      return {
        ...state,
        externalChange: null,
        saveConflictOpen: false,
        editDuringOpenDismissed: false,
      };
    case "applyExternalChange": {
      // "Reload from disk" — replace state with the disk bytes. This
      // mirrors the `load` reducer minus the path/filename plumbing
      // (the file is the same; only its content changed).
      const ec = state.externalChange;
      if (!ec) return state;
      return {
        ...state,
        originalText: ec.text,
        body: ec.body,
        comments: ec.comments,
        dirty: false,
        // Disk content replaced the buffer — the undo stack describes
        // text that no longer exists. Force a fresh editor.
        loadGeneration: state.loadGeneration + 1,
        error: null,
        focusedCommentId: null,
        hoveredCommentId: null,
        composer: null,
        reattachTarget: null,
        externalChange: null,
        saveConflictOpen: false,
        editDuringOpenDismissed: false,
      };
    }
    case "openSaveConflict":
      return { ...state, saveConflictOpen: true };
    case "dismissSaveConflict":
      // Cancel — keep the externalChange pending so the banner
      // remains and a subsequent ⌘S re-opens this modal.
      return { ...state, saveConflictOpen: false };
    case "dismissEditDuringOpen":
      // Cancel — keep externalChange pending; banner shows even with
      // unsaved work, and a subsequent ⌘S still hits save-conflict.
      return { ...state, editDuringOpenDismissed: true };
    case "requestSave":
      return { ...state, pendingSave: true };
    case "clearPendingSave":
      return { ...state, pendingSave: false };
    case "setFilter":
      return { ...state, filter: action.filter };
    case "setSort":
      return { ...state, sort: action.sort };
    default:
      return state;
  }
}
