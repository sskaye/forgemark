import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useDocument } from "../state/DocumentProvider";
import { useAuthorName } from "../state/preferences";
import { FMCard } from "./FMCard";
import {
  removeMarkersFromBody,
  replaceAnchoredText,
  stripAnchoredMarkers,
  type AnchorStatus,
} from "../format";
import type { Comment, Reply } from "../format/types";
import type { FilterMode, SortMode } from "../state/document";
import "./Sidebar.css";
import { commandFor, isTypingTarget, modalOpen } from "../state/keymap";

type SidebarProps = {
  anchorStatuses: Map<number, AnchorStatus>;
};

// Sidebar (Phase 6). Owns:
//   - Dynamic filter dropdown — populated from comment authors + "By me".
//   - Sort: Doc order / Newest / Oldest. Replies stay chronological.
//   - Card lifecycle dispatches (reply / edit / resolve / delete).
//   - Keyboard shortcuts that act on the focused card while focus is in
//     the sidebar: ⌘R reply, ⌘⏎ resolve, E edit own, Delete delete,
//     ↑/↓ (or j/k) move between cards. Chords live in state/keymap.ts.
export function Sidebar({ anchorStatuses }: SidebarProps) {
  const { state, dispatch } = useDocument();
  const [authorName] = useAuthorName();
  const { comments, focusedCommentId, hoveredCommentId, composer, filter, sort } = state;

  const visibleComments = useMemo(
    () => sortComments(filterComments(comments, filter, authorName), sort, anchorStatuses),
    [comments, filter, sort, authorName, anchorStatuses],
  );

  // Phase 9: split into three groups, preserving sort within each.
  const orphans = visibleComments.filter((c) => anchorStatuses.get(c.id)?.kind === "orphaned");
  const floatingNotes = visibleComments.filter(
    (c) => anchorStatuses.get(c.id)?.kind === "floating",
  );
  const attached = visibleComments.filter((c) => anchorStatuses.get(c.id)?.kind === "attached");

  const open = comments.filter((c) => !c.resolved).length;

  // Keyboard shortcuts on the focused card. They apply only while the
  // keyboard focus is inside the sidebar: the reducer's focused comment
  // is also set by clicking an anchor in the editor, and acting on that
  // from the editor — ⌘⏎ resolving a thread mid-sentence, Backspace
  // deleting the comment behind an open dialog — was a trap. Nothing
  // here fires over a dialog or into a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = commandFor(e);
      if (!cmd || modalOpen() || isTypingTarget(e.target)) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest(".fm-sidebar")) return;

      if (cmd === "next-comment" || cmd === "prev-comment") {
        e.preventDefault();
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(".fm-sidebar [data-anchor-card-id]"),
        );
        if (cards.length === 0) return;
        const at = cards.findIndex((el) => el === active || el.contains(active));
        const step = cmd === "next-comment" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : cards.length - 1) : at + step;
        cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
        return;
      }

      if (focusedCommentId == null) return;
      const c = comments.find((x) => x.id === focusedCommentId);
      if (!c) return;
      switch (cmd) {
        case "reply":
          e.preventDefault();
          // No replies on suggestion cards.
          if (c.suggested_edit) return;
          dispatch({ type: "openComposer", composer: { mode: "reply", commentId: c.id } });
          return;
        case "toggle-resolved":
          e.preventDefault();
          dispatch({ type: "toggleResolved", commentId: c.id });
          return;
        case "edit-comment":
          if (c.author !== authorName) return;
          e.preventDefault();
          dispatch({
            type: "openComposer",
            composer: { mode: "editComment", commentId: c.id, initialBody: c.body ?? "" },
          });
          return;
        case "delete-comment":
          e.preventDefault();
          dispatch({
            type: "deleteComment",
            commentId: c.id,
            body: removeMarkersFromBody(state.body, c.id),
          });
          return;
        default:
          return;
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
          <>
            {orphans.length > 0 && (
              <CardSection
                label={`LOST ANCHOR · ${orphans.length}`}
                testid="fm-sidebar-section-orphans"
              >
                {orphans.map((c) => renderCard(c, "orphaned"))}
              </CardSection>
            )}
            {attached.length > 0 && (
              <CardSection
                label={orphans.length > 0 || floatingNotes.length > 0 ? "Attached" : null}
                testid="fm-sidebar-section-attached"
              >
                {attached.map((c) => renderCard(c, "attached"))}
              </CardSection>
            )}
            {floatingNotes.length > 0 && (
              <CardSection
                label={`FLOATING NOTES · ${floatingNotes.length}`}
                testid="fm-sidebar-section-floating"
              >
                {floatingNotes.map((c) => renderCard(c, "floating"))}
              </CardSection>
            )}
          </>
        )}
      </div>
    </aside>
  );

  function renderCard(c: Comment, anchorState: "attached" | "orphaned" | "floating") {
    const replying = composer?.mode === "reply" && composer.commentId === c.id;
    const editing = composer?.mode === "editComment" && composer.commentId === c.id;
    const editingReplyIndex =
      composer?.mode === "editReply" && composer.commentId === c.id ? composer.replyIndex : null;
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
          anchorState={anchorState}
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
            const result = replaceAnchoredText(state.body, c.id, c.suggested_edit.to, state.format);
            if (!result) {
              dispatch({
                type: "error",
                message: `Couldn't find anchor for suggestion ${c.id}.`,
              });
              return;
            }
            if (result.previousText !== c.suggested_edit.from) {
              // Suggestion `from`-mismatch: the markers are still
              // there but the anchored text drifted. Surface as an
              // error for now — Phase 10's file-conflict handling
              // will route this into a richer flow.
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
            const newBody = stripAnchoredMarkers(state.body, c.id, state.format);
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
          onReattach={() => dispatch({ type: "openReattach", commentId: c.id })}
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
  }
}

function CardSection({
  label,
  testid,
  children,
}: {
  label: string | null;
  testid: string;
  children: ReactNode;
}) {
  return (
    <div className="fm-sidebar-section" data-testid={testid}>
      {label && <div className="fm-sidebar-section-label">{label}</div>}
      <ul className="fm-sidebar-list" role="list">
        {children}
      </ul>
    </div>
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
          {(authors.includes(authorName) || filter.kind === "byMe") && (
            <option value="byMe">By me</option>
          )}
          {authors
            .concat(
              // The filter persists across files; keep its option even
              // when this file has nothing by that author, so the select
              // never shows blank.
              filter.kind === "byAuthor" && !authors.includes(filter.author) ? [filter.author] : [],
            )
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

function sortComments(
  comments: Comment[],
  sort: SortMode,
  statuses: Map<number, AnchorStatus>,
): Comment[] {
  if (sort === "doc") {
    // Where the anchor sits in the document, not when the comment was
    // made: ids are creation order, and a comment added later near the
    // top belongs at the top. Orphans and notes have no position and
    // keep id order among themselves.
    const at = (c: Comment) => {
      const st = statuses.get(c.id);
      return st?.kind === "attached" ? st.from : Number.POSITIVE_INFINITY;
    };
    return [...comments].sort((a, b) => at(a) - at(b) || a.id - b.id);
  }
  const when = (c: Comment) => Date.parse(c.timestamp) || 0;
  if (sort === "newest") return [...comments].sort((a, b) => when(b) - when(a) || b.id - a.id);
  return [...comments].sort((a, b) => when(a) - when(b) || a.id - b.id);
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
