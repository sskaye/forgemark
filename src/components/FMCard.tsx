import { type KeyboardEvent } from "react";
import { Avatar } from "./Avatar";
import type { Comment } from "../format/types";
import "./FMCard.css";

type Props = {
  comment: Comment;
  focused: boolean;
  hovered: boolean;
  onFocus: () => void;
  onHover: (entering: boolean) => void;
};

// Phase 4 comment card. Default + read state, plus focus + hover. The
// has-unread-replies + resolved-collapsed + suggested-edit + lost-anchor
// + floating variants land in Phases 6 / 7 / 9.
export function FMCard({ comment, focused, hovered, onFocus, onHover }: Props) {
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
  ]
    .filter(Boolean)
    .join(" ");

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
      {comment.body && <div className="fm-card-body">{stripMarkdown(comment.body)}</div>}
      {comment.suggested_edit && (
        <div className="fm-card-suggestion" data-testid="fm-card-suggestion">
          <span className="fm-card-suggestion-from">{comment.suggested_edit.from}</span>
          <span className="fm-card-suggestion-arrow" aria-hidden>
            →
          </span>
          <span className="fm-card-suggestion-to">{comment.suggested_edit.to}</span>
        </div>
      )}
      {comment.replies && comment.replies.length > 0 && (
        <ul className="fm-card-replies" data-testid="fm-card-replies">
          {comment.replies.map((reply, i) => (
            <li key={`${reply.author}-${reply.timestamp}-${i}`} className="fm-card-reply">
              <CardAuthorRow
                author={reply.author}
                timestamp={reply.timestamp}
                edited={Boolean(reply.edited_at)}
                size={18}
              />
              <div className="fm-card-reply-body">{stripMarkdown(reply.body)}</div>
            </li>
          ))}
        </ul>
      )}
    </article>
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

// Strip the simplest markdown formatting from a comment-card preview so
// that **bold** etc. don't render as literal asterisks. Phase 4 doesn't
// need full markdown rendering inside cards — short prose is the norm.
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

function plainPreview(comment: Comment, max: number): string {
  const body = comment.body ? stripMarkdown(comment.body) : "";
  if (body) return body.length > max ? body.slice(0, max - 1) + "…" : body;
  if (comment.suggested_edit) {
    return `Suggests: ${comment.suggested_edit.from} → ${comment.suggested_edit.to}`;
  }
  return "(no body)";
}

// Lightweight relative timestamp. Phase 4 needs only "today", "yesterday",
// "N days ago" — and a fallback to the absolute date for older comments.
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
  // Beyond a month, show the date.
  const d = new Date(t);
  const monthShort = d.toLocaleString(undefined, { month: "short" });
  return `${monthShort} ${d.getDate()}`;
}
