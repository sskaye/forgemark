import { useEffect, useRef } from "react";
import { clampToViewport } from "./NewCommentComposer";
import "./OverlapPrompt.css";

type Props = {
  // Client-space pixel anchor (below the selection), like the composer.
  x: number;
  y: number;
  // Attach the note as a reply to the overlapped comment.
  onReply: () => void;
  // Dismiss without doing anything.
  onCancel: () => void;
};

// Shown when a new-comment selection overlaps an existing comment's
// anchor. The format can't represent overlapping anchors, so we offer to
// reply to the existing comment instead. Mirrors the composer's floating
// placement and on-screen clamping.
export function OverlapPrompt({ x, y, onReply, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const replyRef = useRef<HTMLButtonElement | null>(null);

  // Focus Reply so the prompt is keyboard-operable immediately.
  useEffect(() => {
    replyRef.current?.focus();
  }, []);

  // Keep on-screen (same approach as NewCommentComposer).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.style.transform = "";
    const rect = node.getBoundingClientRect();
    const { dx, dy } = clampToViewport(rect, window.innerWidth, window.innerHeight);
    if (dx !== 0 || dy !== 0) node.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [x, y]);

  // Click-outside cancels.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const c = containerRef.current;
      if (!c) return;
      if (e.target instanceof Node && c.contains(e.target)) return;
      onCancel();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onCancel]);

  const onKey: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      ref={containerRef}
      className="fm-overlap-prompt"
      data-testid="fm-overlap-prompt"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="Overlapping comment"
      onKeyDown={onKey}
    >
      <div className="fm-overlap-prompt-message">
        Overlaps with existing comment. Reply instead?
      </div>
      <div className="fm-overlap-prompt-footer">
        <button
          type="button"
          className="fm-overlap-prompt-cancel"
          onClick={onCancel}
          data-testid="fm-overlap-prompt-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          ref={replyRef}
          className="fm-overlap-prompt-reply"
          onClick={onReply}
          data-testid="fm-overlap-prompt-reply"
        >
          Reply
        </button>
      </div>
    </div>
  );
}
