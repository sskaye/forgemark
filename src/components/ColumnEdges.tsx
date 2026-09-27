import { useRef, useState, type PointerEvent } from "react";
import {
  DOCUMENT_WIDTH_RANGE,
  clampDocumentWidth,
  useDocumentWidth,
  type DocumentWidth,
} from "../state/preferences";
import {
  charWidthPx,
  endDocumentWidthPreview,
  previewDocumentWidth,
} from "../services/documentWidth";

// Handles on both edges of the document column. Dragging either one
// resizes the column about its centre, so the other edge moves too;
// dragging it out to the pane's edge is Full.
// Double-click goes back to the default. The title bar's width control
// is the keyboard path, so the handles are for the pointer only.
export function ColumnEdges() {
  const [, setWidth] = useDocumentWidth();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    side: 1 | -1;
    startPx: number;
    maxPx: number;
    charPx: number;
    latest: DocumentWidth | null;
  } | null>(null);

  const onPointerDown = (side: 1 | -1) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const column = e.currentTarget.parentElement;
    const pane = column?.closest<HTMLElement>(".fm-editor-pane");
    if (!column || !pane) return;
    e.preventDefault();
    const style = getComputedStyle(column);
    const gutters = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    drag.current = {
      x: e.clientX,
      side,
      startPx: column.getBoundingClientRect().width - gutters,
      maxPx: pane.clientWidth - gutters,
      charPx: charWidthPx(),
      latest: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.dataset.columnResizing = "true";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Each edge moves by the pointer's travel, so the text width
    // changes by twice that.
    const px = d.startPx + 2 * d.side * (e.clientX - d.x);
    const chars = px / d.charPx;
    const next: DocumentWidth = px >= d.maxPx ? "full" : clampDocumentWidth(chars);
    if (next !== d.latest) {
      d.latest = next;
      previewDocumentWidth(next);
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
    delete document.body.dataset.columnResizing;
    if (d.latest !== null) setWidth(d.latest);
    endDocumentWidthPreview();
  };

  const reset = () => setWidth(DOCUMENT_WIDTH_RANGE.default);

  return (
    <>
      {([-1, 1] as const).map((side) => (
        <div
          key={side}
          className={
            "fm-column-edge " + (side < 0 ? "fm-column-edge--left" : "fm-column-edge--right")
          }
          data-testid={side < 0 ? "fm-column-edge-left" : "fm-column-edge-right"}
          data-dragging={dragging ? "true" : "false"}
          aria-hidden="true"
          title="Drag to change the document width. Double-click to reset."
          onPointerDown={onPointerDown(side)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={reset}
        />
      ))}
    </>
  );
}
