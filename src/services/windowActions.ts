// Window-resize actions for the Window > Move & Resize submenu.
// Mirrors macOS's native Window menu structure: Fill, Center,
// Halves (Left / Right / Top / Bottom), Quarters (TL / TR / BL / BR),
// and "Return to Previous Size" which restores the geometry from
// just before the most recent Move & Resize action.
//
// All math is in CSS logical pixels — `window.screen.avail*` and
// Tauri's LogicalPosition / LogicalSize share that coordinate space,
// so HiDPI scale factors don't enter into our calculations.

import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";

export type WindowAction =
  | "window-fill"
  | "window-center"
  | "window-left-half"
  | "window-right-half"
  | "window-top-half"
  | "window-bottom-half"
  | "window-top-left-quarter"
  | "window-top-right-quarter"
  | "window-bottom-left-quarter"
  | "window-bottom-right-quarter"
  | "window-return-previous";

type Geometry = { x: number; y: number; w: number; h: number };

// Memo of the last "before resize" geometry. Set right before each
// non-return action; cleared on return-previous so a double-tap returns
// where you started rather than ping-ponging.
//
// Module scope is right for this: it's a property of the window, and
// Forgemark is single-window (tabs, not windows — see
// docs/ARCHITECTURE.md). It is deliberately NOT per-document;
// resizing is not something a tab owns.
let previousGeometry: Geometry | null = null;

export async function applyWindowAction(action: WindowAction): Promise<void> {
  const win = getCurrentWindow();

  if (action === "window-return-previous") {
    if (!previousGeometry) return;
    const g = previousGeometry;
    previousGeometry = null;
    await win.setPosition(new LogicalPosition(g.x, g.y));
    await win.setSize(new LogicalSize(g.w, g.h));
    return;
  }

  // Snapshot current geometry before the resize so Return to
  // Previous Size has somewhere to go back to.
  const scale = await win.scaleFactor();
  const curPos = await win.outerPosition();
  const curSize = await win.outerSize();
  const current: Geometry = {
    x: curPos.x / scale,
    y: curPos.y / scale,
    w: curSize.width / scale,
    h: curSize.height / scale,
  };
  previousGeometry = current;

  // Compute the target geometry from the screen's available area.
  const availW = window.screen.availWidth;
  const availH = window.screen.availHeight;
  const availLeft =
    "availLeft" in window.screen ? Number((window.screen as { availLeft?: number }).availLeft) : 0;
  const availTop =
    "availTop" in window.screen ? Number((window.screen as { availTop?: number }).availTop) : 0;
  const halfW = Math.floor(availW / 2);
  const halfH = Math.floor(availH / 2);

  let x = availLeft;
  let y = availTop;
  let w = availW;
  let h = availH;

  switch (action) {
    case "window-fill":
      // already filling
      break;
    case "window-center": {
      // Keep the current size, centre on the available area. Reads
      // `current`, not `previousGeometry` — they hold the same value here
      // (the memo was just assigned from it), but naming the one we mean
      // keeps this correct if the snapshot ever moves.
      x = availLeft + Math.max(0, Math.floor((availW - current.w) / 2));
      y = availTop + Math.max(0, Math.floor((availH - current.h) / 2));
      w = current.w;
      h = current.h;
      break;
    }
    case "window-left-half":
      w = halfW;
      break;
    case "window-right-half":
      x = availLeft + halfW;
      w = availW - halfW;
      break;
    case "window-top-half":
      h = halfH;
      break;
    case "window-bottom-half":
      y = availTop + halfH;
      h = availH - halfH;
      break;
    case "window-top-left-quarter":
      w = halfW;
      h = halfH;
      break;
    case "window-top-right-quarter":
      x = availLeft + halfW;
      w = availW - halfW;
      h = halfH;
      break;
    case "window-bottom-left-quarter":
      y = availTop + halfH;
      w = halfW;
      h = availH - halfH;
      break;
    case "window-bottom-right-quarter":
      x = availLeft + halfW;
      y = availTop + halfH;
      w = availW - halfW;
      h = availH - halfH;
      break;
  }

  await win.setPosition(new LogicalPosition(x, y));
  await win.setSize(new LogicalSize(w, h));
}

export function isWindowAction(id: string): id is WindowAction {
  return (
    id === "window-fill" ||
    id === "window-center" ||
    id === "window-left-half" ||
    id === "window-right-half" ||
    id === "window-top-half" ||
    id === "window-bottom-half" ||
    id === "window-top-left-quarter" ||
    id === "window-top-right-quarter" ||
    id === "window-bottom-left-quarter" ||
    id === "window-bottom-right-quarter" ||
    id === "window-return-previous"
  );
}
