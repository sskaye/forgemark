import { useEffect, useMemo, useRef } from "react";
import { useDocument } from "../state/DocumentProvider";
import { useAuthorName } from "../state/preferences";
import { FMCard } from "./FMCard";
import { removeMarkersFromBody, replaceAnchoredText, stripAnchoredMarkers } from "../format";
import type { Comment, Reply } from "../format/types";
import type { FilterMode, SortMode } from "../state/document";
import "./Sidebar.css";

// Sidebar (Phase 6). Owns:
//   - Dynamic filter dropdown — populated from comment authors + "By me".
//   - Sort: Doc order / Newest / Oldest. Replies stay chronological.
//   - Card lifecycle dispatches (reply / edit / resolve / delete).
//   - Global keyboard shortcuts that act on the focused card:
//       ⌘R reply, ⌘⏎ resolve, ⌘⇧E edit own, Delete delete.
export function Sidebar() {
  const { state, dispatch } = useDocument();
  const [authorName] = useAuthorName();
  const { comments, focusedCommentId, hoveredCommentId, composer, filter, sort } = state;

  const visibleComments = useMemo(
    () => sortComments(filterComments(comments, filter, authorName), sort),
    [comments, filter, sort, authorName],
  );

  const open = comments.filter((c) => !c.resolved).length;

  // Global keyboard shortcuts. Active when a card is focused; the
  // composer's own keydown handler stops propagation so these don't
  // fire while the user is typing in a textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusedCommentId == null) return;
      const c = comments.find((x) => x.id === focusedCommentId);
      if (!c) return;
      const mod = e.metaKey || e.ctrlKey;
      // ⌘R — reply (no-op on suggestion cards per Phase 7 design)
      if (mod && !e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (c.suggested_edit) return;
        dispatch({
          type: "openComposer",
          composer: { mode: "reply", commentId: c.id },
        });
        return;
      }
      // ⌘⏎ — resolve / unresolve (when card focused)
      if (mod && e.key === "Enter") {
        e.preventDefault();
        dispatch({ type: "toggleResolved", commentId: c.id });
        return;
      }
      // ⌘⇧E — edit own comment
      if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
        if (c.author !== authorName) return;
        e.preventDefault();
        dispatch({
          type: "openComposer",
          composer: {
            mode: "editComment",
            commentId: c.id,
            initialBody: c.body ?? "",
          },
        });
        return;
      }
      // Delete / Backspace — delete the focused comment.
      if ((e.key === "Delete" || e.key === "Backspace") && !mod && !isTypingTarget(e.target)) {
        e.preventDefault();
        const newBody = removeMarkersFromBody(state.body, c.id);
        dispatch({ type: "deleteComment", commentId: c.id, body: newBody });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedCommentId, comments, dispatch, authorName, state.body]);

  return (
    <aside className="fm-sidebar" data-testid="fm-sidebar" aria-label="Comments">
      <SidebarHeader
        open={open}
        total={comments.length}
        comments={comments}
        filter={filter}
        sort={sort}
        authorName={authorName}
        onFilter={(f) => dispatch({ type: "setFilter", filter: f })}
        onSort={(s) => dispatch({ type: "setSort", sort: s })}
      />
      <div className="fm-sidebar-body">
        {comments.length === 0 ? (
          <EmptyState empty="no-comments" />
        ) : visibleComments.length === 0 ? (
          <EmptyState empty="filtered-out" />
        ) : (
          <ul className="fm-sidebar-list" role="list">
            {visibleComments.map((c) => {
              const replying = composer?.mode === "reply" && composer.commentId === c.id;
              const editing = composer?.mode === "editComment" && composer.commentId === c.id;
              const editingReplyIndex =
                composer?.mode === "editReply" && composer.commentId === c.id
                  ? composer.replyIndex
                  : null;
              return (
                <li key={c.id} className="fm-sidebar-item">
                  <FocusableCard
                    cardKey={c.id}
                    comment={c}
                    authorName={authorName}
                    focused={focusedCommentId === c.id}
                    hovered={hoveredCommentId === c.id}
                    replying={replying}
                    editing={editing}
                    editingReplyIndex={editingReplyIndex}
                    onFocus={() => dispatch({ type: "setFocusedComment", id: c.id })}
                    onHover={(entering) =>
                      dispatch({
                        type: "setHoveredComment",
                        id: entering ? c.id : null,
                      })
                    }
                    onReply={() =>
                      dispatch({
                        type: "openComposer",
                        composer: { mode: "reply", commentId: c.id },
                      })
                    }
                    onEdit={() =>
                      dispatch({
                        type: "openComposer",
                        composer: {
                          mode: "editComment",
                          commentId: c.id,
                          initialBody: c.body ?? "",
                        },
                      })
                    }
                    onResolve={() => dispatch({ type: "toggleResolved", commentId: c.id })}
                    onDelete={() => {
                      const newBody = removeMarkersFromBody(state.body, c.id);
                      dispatch({ type: "deleteComment", commentId: c.id, body: newBody });
                    }}
                    onAcceptSuggestion={() => {
                      if (!c.suggested_edit) return;
                      const result = replaceAnchoredText(state.body, c.id, c.suggested_edit.to);
                      if (!result) {
                        dispatch({
                          type: "error",
                          message: `Couldn't find anchor for suggestion ${c.id}.`,
                        });
                        return;
                      }
                      // `from` mismatch routes to the lost-anchor flow
                      // (Phase 9). Phase 7 surfaces an error banner with a
                      // clear message rather than silently drifting; the
                      // proper Reattach modal lands in Phase 9.
                      if (result.previousText !== c.suggested_edit.from) {
                        dispatch({
                          type: "error",
                          message:
                            "Anchored text has changed since the suggestion was made; reattach in a future build.",
                        });
                        return;
                      }
                      dispatch({
                        type: "acceptSuggestion",
                        commentId: c.id,
                        body: result.body,
                      });
                    }}
                    onRejectSuggestion={() => {
                      const newBody = stripAnchoredMarkers(state.body, c.id);
                      if (newBody == null) {
                        dispatch({
                          type: "error",
                          message: `Couldn't find anchor for suggestion ${c.id}.`,
                        });
                        return;
                      }
                      dispatch({
                        type: "rejectSuggestion",
                        commentId: c.id,
                        body: newBody,
                      });
                    }}
                    onReplyEdit={(index) => {
                      const reply = c.replies?.[index];
                      if (!reply) return;
                      dispatch({
                        type: "openComposer",
                        composer: {
                          mode: "editReply",
                          commentId: c.id,
                          replyIndex: index,
                          initialBody: reply.body,
                        },
                      });
                    }}
                    onReplyDelete={(index) =>
                      dispatch({
                        type: "deleteReply",
                        commentId: c.id,
                        replyIndex: index,
                      })
                    }
                    onComposerSubmit={(text) => {
                      handleComposerSubmit(state, dispatch, authorName, text);
                    }}
                    onComposerCancel={() => dispatch({ type: "closeComposer" })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// Submission handler shared by all four composer modes. The Sidebar
// reads composer.mode and dispatches the appropriate action.
function handleComposerSubmit(
  state: ReturnType<typeof useDocument>["state"],
  dispatch: ReturnType<typeof useDocument>["dispatch"],
  authorName: string,
  text: string,
) {
  const c = state.composer;
  if (!c) return;
  const now = new Date().toISOString();
  if (c.mode === "reply") {
    const reply: Reply = { author: authorName, timestamp: now, body: text };
    dispatch({ type: "addReply", commentId: c.commentId, reply });
  } else if (c.mode === "editComment") {
    dispatch({
      type: "editComment",
      commentId: c.commentId,
      body: text,
      editedAt: now,
    });
  } else if (c.mode === "editReply") {
    dispatch({
      type: "editReply",
      commentId: c.commentId,
      replyIndex: c.replyIndex,
      body: text,
      editedAt: now,
    });
  }
  // The "new" mode is handled by the EditorPane (which has the editor
  // ref needed to apply the anchor mark).
}

function FocusableCard({ cardKey, ...props }: { cardKey: number } & Parameters<typeof FMCard>[0]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.focused) return;
    if (!ref.current) return;
    if (typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [props.focused, cardKey]);
  return (
    <div ref={ref}>
      <FMCard {...props} />
    </div>
  );
}

function SidebarHeader({
  open,
  total,
  comments,
  filter,
  sort,
  authorName,
  onFilter,
  onSort,
}: {
  open: number;
  total: number;
  comments: Comment[];
  filter: FilterMode;
  sort: SortMode;
  authorName: string;
  onFilter: (f: FilterMode) => void;
  onSort: (s: SortMode) => void;
}) {
  // Distinct author names appearing in this file's comments. Authors are
  // ordered by first appearance (stable across reorders).
  const authors = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of comments) {
      if (!seen.has(c.author)) {
        seen.add(c.author);
        out.push(c.author);
      }
    }
    return out;
  }, [comments]);

  const filterValue = filterToValue(filter);

  return (
    <div className="fm-sidebar-header">
      <div className="fm-sidebar-title-row">
        <span className="fm-sidebar-title">Comments</span>
        <span className="fm-sidebar-counts">
          {open} open · {total} total
        </span>
      </div>
      <div className="fm-sidebar-controls">
        <select
          className="fm-select"
          aria-label="Filter comments"
          value={filterValue}
          onChange={(e) => onFilter(valueToFilter(e.target.value))}
          data-testid="fm-sidebar-filter"
        >
          <option value="all">All comments</option>
          <option value="open">Open only</option>
          <option value="resolved">Resolved</option>
          {authors.includes(authorName) && <option value="byMe">By me</option>}
          {authors
            .filter((a) => a !== authorName)
            .map((a) => (
              <option key={a} value={`byAuthor:${a}`}>
                By {a}
              </option>
            ))}
        </select>
        <div className="fm-spacer" />
        <select
          className="fm-select fm-select-compact"
          aria-label="Sort comments"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortMode)}
          data-testid="fm-sidebar-sort"
        >
          <option value="doc">Doc order</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  );
}

function EmptyState({ empty }: { empty: "no-comments" | "filtered-out" }) {
  return (
    <div className="fm-sidebar-empty">
      <div className="fm-sidebar-empty-title">
        {empty === "no-comments" ? "No comments yet." : "No comments match this filter."}
      </div>
      <div className="fm-sidebar-empty-body">
        {empty === "no-comments"
          ? "Select text in the document to start a review."
          : "Try All comments or change the filter."}
      </div>
    </div>
  );
}

// ── pure helpers ──────────────────────────────────────────────────────

function filterComments(comments: Comment[], filter: FilterMode, authorName: string): Comment[] {
  switch (filter.kind) {
    case "all":
      return comments;
    case "open":
      return comments.filter((c) => !c.resolved);
    case "resolved":
      return comments.filter((c) => c.resolved);
    case "byMe":
      return comments.filter((c) => c.author === authorName);
    case "byAuthor":
      return comments.filter((c) => c.author === filter.author);
  }
}

function sortComments(comments: Comment[], sort: SortMode): Comment[] {
  if (sort === "doc") return [...comments].sort((a, b) => a.id - b.id);
  if (sort === "newest")
    return [...comments].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return [...comments].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function filterToValue(f: FilterMode): string {
  switch (f.kind) {
    case "byAuthor":
      return `byAuthor:${f.author}`;
    default:
      return f.kind;
  }
}

function valueToFilter(v: string): FilterMode {
  if (v === "open" || v === "resolved" || v === "byMe" || v === "all") {
    return { kind: v as "all" | "open" | "resolved" | "byMe" } as FilterMode;
  }
  if (v.startsWith("byAuthor:")) {
    return { kind: "byAuthor", author: v.slice("byAuthor:".length) };
  }
  return { kind: "all" };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "textarea" || tag === "input" || target.isContentEditable === true;
}
