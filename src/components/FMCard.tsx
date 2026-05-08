import { useState, type KeyboardEvent } from "react";
import { Avatar } from "./Avatar";
import { InlineComposer } from "./InlineComposer";
import type { Comment, Reply } from "../format/types";
import "./FMCard.css";

type Props = {
  comment: Comment;
  focused: boolean;
  hovered: boolean;
  // The current user's name; controls whether the Edit affordance shows.
  authorName: string;
  // True when this comment is the active reply target (an inline reply
  // composer is rendered at the bottom of the card).
  replying: boolean;
  // True when the comment body itself is being edited.
  editing: boolean;
  // editingReplyIndex !== null when a specific reply is being edited.
  editingReplyIndex: number | null;
  // Phase 9: anchor state classifies the card variant.
  //   - "attached"  → markers present in body (default)
  //   - "orphaned"  → no markers; show a "lost anchor" pill + Reattach CTA
  //   - "floating"  → comment has floating: true; show "floating" pill
  anchorState?: "attached" | "orphaned" | "floating";
  onFocus: () => void;
  onHover: (entering: boolean) => void;
  onReply: () => void;
  onEdit: () => void;
  onResolve: () => void;
  onDelete: () => void;
  // Phase 7: suggested-edit lifecycle handlers. Only invoked when
  // `comment.suggested_edit` is present.
  onAcceptSuggestion: () => void;
  onRejectSuggestion: () => void;
  // Phase 9: open the Reattach modal for this orphan.
  onReattach?: () => void;
  onReplyEdit: (index: number) => void;
  onReplyDelete: (index: number) => void;
  onComposerSubmit: (body: string) => void;
  onComposerCancel: () => void;
};

// Phase 6 comment card. Default + read state from Phase 4, plus:
//   - Action row revealed on focus (Reply / Edit / Resolve / Delete).
//   - Edit affordance gated to the original author.
//   - Resolved cards render in a compact one-line collapsed form unless
//     focused, in which case they expand back to the regular card.
//   - Reply / Edit composers render inline.
export function FMCard({
  comment,
  focused,
  hovered,
  authorName,
  replying,
  editing,
  editingReplyIndex,
  anchorState = "attached",
  onFocus,
  onHover,
  onReply,
  onEdit,
  onResolve,
  onDelete,
  onAcceptSuggestion,
  onRejectSuggestion,
  onReattach,
  onReplyEdit,
  onReplyDelete,
  onComposerSubmit,
  onComposerCancel,
}: Props) {
  const isOwn = comment.author === authorName;
  const isSuggestion = Boolean(comment.suggested_edit);
  const isOrphan = anchorState === "orphaned";
  const isFloating = anchorState === "floating";
  const showCollapsed = comment.resolved && !focused && !replying && !editing;

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onFocus();
    }
  };

  const className = [
    "fm-card",
    focused ? "is-focused" : "",
    hovered ? "is-hovered" : "",
    comment.resolved ? "is-resolved" : "",
    showCollapsed ? "is-collapsed" : "",
    isOrphan ? "is-orphan" : "",
    isFloating ? "is-floating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (showCollapsed) {
    return (
      <article
        className={className}
        data-testid={`fm-card-${comment.id}`}
        data-anchor-card-id={comment.id}
        role="button"
        tabIndex={0}
        aria-pressed={focused}
        aria-label={`Resolved comment by ${comment.author}: ${plainPreview(comment, 60)}`}
        onClick={onFocus}
        onKeyDown={onKey}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <div className="fm-card-collapsed-row">
          <Avatar name={comment.author} size={18} />
          <span className="fm-card-collapsed-author">{comment.author}</span>
          <span className="fm-card-collapsed-check" aria-hidden>
            ✓
          </span>
          <span className="fm-card-collapsed-preview">{plainPreview(comment, 60)}</span>
        </div>
      </article>
    );
  }

  return (
    <article
      className={className}
      data-testid={`fm-card-${comment.id}`}
      data-anchor-card-id={comment.id}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`Comment by ${comment.author}: ${plainPreview(comment, 60)}`}
      onClick={onFocus}
      onKeyDown={onKey}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <CardAuthorRow
        author={comment.author}
        timestamp={comment.timestamp}
        edited={Boolean(comment.edited_at)}
      />
      {isOrphan && (
        <div
          className="fm-card-pill fm-card-pill-orphan"
          data-testid={`fm-card-orphan-pill-${comment.id}`}
        >
          Lost anchor
          {comment.anchor_text && (
            <span className="fm-card-pill-anchor-text">“{truncate(comment.anchor_text, 60)}”</span>
          )}
        </div>
      )}
      {isFloating && (
        <div
          className="fm-card-pill fm-card-pill-floating"
          data-testid={`fm-card-floating-pill-${comment.id}`}
        >
          Floating note
        </div>
      )}
      {editing ? (
        <InlineComposer
          initialBody={comment.body ?? ""}
          submitLabel="Save"
          headerLabel={`Editing ${comment.author}'s comment`}
          onSubmit={onComposerSubmit}
          onCancel={onComposerCancel}
        />
      ) : (
        comment.body && <div className="fm-card-body">{stripMarkdown(comment.body)}</div>
      )}
      {comment.suggested_edit && !editing && (
        <div className="fm-card-suggestion" data-testid="fm-card-suggestion">
          <span className="fm-card-suggestion-from">{comment.suggested_edit.from}</span>
          <span className="fm-card-suggestion-arrow" aria-hidden>
            →
          </span>
          <span className="fm-card-suggestion-to">{comment.suggested_edit.to}</span>
        </div>
      )}
      {comment.replies && comment.replies.length > 0 && !editing && (
        <ul className="fm-card-replies" data-testid="fm-card-replies">
          {comment.replies.map((reply, i) => (
            <ReplyView
              key={`${reply.author}-${reply.timestamp}-${i}`}
              reply={reply}
              isOwn={reply.author === authorName}
              editing={editingReplyIndex === i}
              onEdit={() => onReplyEdit(i)}
              onDelete={() => onReplyDelete(i)}
              onComposerSubmit={onComposerSubmit}
              onComposerCancel={onComposerCancel}
            />
          ))}
        </ul>
      )}
      {replying && (
        <InlineComposer
          submitLabel="Reply"
          headerLabel={`${authorName} is replying`}
          placeholder="Add a reply…"
          onSubmit={onComposerSubmit}
          onCancel={onComposerCancel}
        />
      )}
      {focused && !editing && !replying && editingReplyIndex === null && (
        <div className="fm-card-actions" role="toolbar" aria-label="Comment actions">
          {isOrphan ? (
            <>
              <button
                type="button"
                className="fm-card-action fm-card-action-accept"
                onClick={(e) => {
                  e.stopPropagation();
                  onReattach?.();
                }}
                data-testid={`fm-card-reattach-${comment.id}`}
              >
                Reattach…
              </button>
              <div className="fm-card-actions-spacer" />
              <button
                type="button"
                className="fm-card-action fm-card-action-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                data-testid={`fm-card-delete-${comment.id}`}
              >
                Delete
              </button>
            </>
          ) : isSuggestion ? (
            <>
              <button
                type="button"
                className="fm-card-action fm-card-action-accept"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptSuggestion();
                }}
                data-testid={`fm-card-accept-${comment.id}`}
              >
                ✓ Accept
              </button>
              <button
                type="button"
                className="fm-card-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onRejectSuggestion();
                }}
                data-testid={`fm-card-reject-${comment.id}`}
              >
                Reject
              </button>
              {isOwn && (
                <button
                  type="button"
                  className="fm-card-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  data-testid={`fm-card-edit-${comment.id}`}
                >
                  Edit
                </button>
              )}
              <div className="fm-card-actions-spacer" />
              <button
                type="button"
                className="fm-card-action fm-card-action-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                data-testid={`fm-card-delete-${comment.id}`}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="fm-card-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onReply();
                }}
                data-testid={`fm-card-reply-${comment.id}`}
              >
                Reply
              </button>
              {isOwn && (
                <button
                  type="button"
                  className="fm-card-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  data-testid={`fm-card-edit-${comment.id}`}
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                className="fm-card-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve();
                }}
                data-testid={`fm-card-resolve-${comment.id}`}
              >
                {comment.resolved ? "Reopen" : "Resolve"}
              </button>
              <div className="fm-card-actions-spacer" />
              <button
                type="button"
                className="fm-card-action fm-card-action-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                data-testid={`fm-card-delete-${comment.id}`}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ReplyView({
  reply,
  isOwn,
  editing,
  onEdit,
  onDelete,
  onComposerSubmit,
  onComposerCancel,
}: {
  reply: Reply;
  isOwn: boolean;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onComposerSubmit: (body: string) => void;
  onComposerCancel: () => void;
}) {
  return (
    <li className="fm-card-reply">
      <CardAuthorRow
        author={reply.author}
        timestamp={reply.timestamp}
        edited={Boolean(reply.edited_at)}
        size={18}
      />
      {editing ? (
        <InlineComposer
          initialBody={reply.body}
          submitLabel="Save"
          headerLabel={`Editing ${reply.author}'s reply`}
          onSubmit={onComposerSubmit}
          onCancel={onComposerCancel}
        />
      ) : (
        <>
          <div className="fm-card-reply-body">{stripMarkdown(reply.body)}</div>
          <div className="fm-card-reply-actions">
            {isOwn && (
              <button
                type="button"
                className="fm-card-reply-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="fm-card-reply-action fm-card-reply-action-danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function CardAuthorRow({
  author,
  timestamp,
  edited,
  size = 22,
}: {
  author: string;
  timestamp: string;
  edited: boolean;
  size?: number;
}) {
  return (
    <div className="fm-card-author-row">
      <Avatar name={author} size={size} />
      <span className="fm-card-author">{author}</span>
      <span className="fm-card-timestamp" title={timestamp}>
        {formatRelative(timestamp)}
      </span>
      {edited && (
        <span className="fm-card-edited" title="Edited">
          (edited)
        </span>
      )}
    </div>
  );
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function plainPreview(comment: Comment, max: number): string {
  const body = comment.body ? stripMarkdown(comment.body) : "";
  if (body) return body.length > max ? body.slice(0, max - 1) + "…" : body;
  if (comment.suggested_edit) {
    return `Suggests: ${comment.suggested_edit.from} → ${comment.suggested_edit.to}`;
  }
  return "(no body)";
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
  const d = new Date(t);
  const monthShort = d.toLocaleString(undefined, { month: "short" });
  return `${monthShort} ${d.getDate()}`;
}

// Suppress unused-var lint for setState helper if introduced later.
void useState;
