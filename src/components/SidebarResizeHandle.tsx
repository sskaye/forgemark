import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SIDEBAR_WIDTH_RANGE, clampSidebarWidth } from "../state/preferences";

type Props = {
  width: number;
  // Called with the final width when a drag ends, on a keyboard step,
  // and on double-click (reset). During a drag the handle sizes the
  // sidebar directly through `onPreview` so React need not re-render
  // the comment list on every pointer move.
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
};

const KEY_STEP = 16;

// The sidebar's left edge. Dragging it resizes the sidebar; the width
// is remembered across launches. Widths are computed from the drag
// delta rather than the pointer's absolute position, so the handle does
// not care where the sidebar sits in the window.
export function SidebarResizeHandle({ width, onPreview, onCommit }: Props) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width, latest: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.dataset.sidebarResizing = "true";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // The sidebar is on the right, so moving the pointer left widens it.
    const next = clampSidebarWidth(d.startWidth + (d.startX - e.clientX));
    if (next !== d.latest) {
      d.latest = next;
      onPreview(next);
    }
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    delete document.body.dataset.sidebarResizing;
    onCommit(d.latest);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width + KEY_STEP;
    else if (e.key === "ArrowRight") next = width - KEY_STEP;
    else if (e.key === "Home") next = SIDEBAR_WIDTH_RANGE.max;
    else if (e.key === "End") next = SIDEBAR_WIDTH_RANGE.min;
    if (next === null) return;
    e.preventDefault();
    onCommit(clampSidebarWidth(next));
  };

  return (
    <div
      className="fm-sidebar-resize"
      data-testid="fm-sidebar-resize"
      data-dragging={dragging ? "true" : "false"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize comments sidebar"
      aria-valuemin={SIDEBAR_WIDTH_RANGE.min}
      aria-valuemax={SIDEBAR_WIDTH_RANGE.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onCommit(SIDEBAR_WIDTH_RANGE.default)}
      onKeyDown={onKeyDown}
    />
  );
}
