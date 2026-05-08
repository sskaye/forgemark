import { useEffect, useRef } from "react";
import { useDocument } from "../state/DocumentProvider";
import { FMCard } from "./FMCard";
import "./Sidebar.css";

// Phase 4 sidebar. Shows the comment cards, sorted by document position
// (the parser already returns them in that order). The empty state lands
// when no comments exist.
//
// Filter / sort affordances are scaffolded but not yet wired — Phase 6
// adds the dynamic filter and sort behaviour.
export function Sidebar() {
  const { state, dispatch } = useDocument();
  const { comments, focusedCommentId, hoveredCommentId } = state;
  const open = comments.filter((c) => !c.resolved).length;

  return (
    <aside className="fm-sidebar" data-testid="fm-sidebar" aria-label="Comments">
      <SidebarHeader open={open} total={comments.length} />
      <div className="fm-sidebar-body">
        {comments.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="fm-sidebar-list" role="list">
            {comments.map((c) => (
              <li key={c.id} className="fm-sidebar-item">
                <FocusableCard
                  cardKey={c.id}
                  comment={c}
                  focusedCommentId={focusedCommentId}
                  hoveredCommentId={hoveredCommentId}
                  onFocus={() => dispatch({ type: "setFocusedComment", id: c.id })}
                  onHover={(entering) =>
                    dispatch({ type: "setHoveredComment", id: entering ? c.id : null })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function FocusableCard({
  cardKey,
  comment,
  focusedCommentId,
  hoveredCommentId,
  onFocus,
  onHover,
}: {
  cardKey: number;
  comment: Parameters<typeof FMCard>[0]["comment"];
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  onFocus: () => void;
  onHover: (entering: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // When the focused comment changes, scroll the corresponding card into
  // view so the click-on-anchor → focus-the-card flow stays connected.
  useEffect(() => {
    if (focusedCommentId !== cardKey) return;
    if (!ref.current) return;
    // jsdom (used by tests) doesn't implement scrollIntoView; check first.
    if (typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedCommentId, cardKey]);
  return (
    <div ref={ref}>
      <FMCard
        comment={comment}
        focused={focusedCommentId === cardKey}
        hovered={hoveredCommentId === cardKey}
        onFocus={onFocus}
        onHover={onHover}
      />
    </div>
  );
}

function SidebarHeader({ open, total }: { open: number; total: number }) {
  return (
    <div className="fm-sidebar-header">
      <div className="fm-sidebar-title-row">
        <span className="fm-sidebar-title">Comments</span>
        <span className="fm-sidebar-counts">
          {open} open · {total} total
        </span>
      </div>
      <div className="fm-sidebar-controls">
        <select className="fm-select" aria-label="Filter comments" defaultValue="all">
          <option value="all">All comments</option>
          <option value="open">Open only</option>
          <option value="resolved">Resolved</option>
        </select>
        <div className="fm-spacer" />
        <select
          className="fm-select fm-select-compact"
          aria-label="Sort comments"
          defaultValue="doc"
        >
          <option value="doc">Doc order</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="fm-sidebar-empty">
      <div className="fm-sidebar-empty-title">No comments yet.</div>
      <div className="fm-sidebar-empty-body">Select text in the document to start a review.</div>
    </div>
  );
}
