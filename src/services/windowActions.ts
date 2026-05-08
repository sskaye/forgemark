// Window-resize actions for the Window > Move & Resize submenu.
// macOS-style halves / quarters / fill / center, all computed from
// `window.screen.availWidth` / `availHeight` (the screen excluding
// menu bar and dock) and applied via Tauri's window API.
//
// We use logical (CSS) pixels throughout — both window.screen and
// LogicalSize / LogicalPosition share that coordinate space, so we
// don't need to chase HiDPI scale factors.

import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";

export type WindowAction =
  | "window-fill"
  | "window-center"
  | "window-left-half"
  | "window-right-half"
  | "window-top-half"
  | "window-bottom-half";

export async function applyWindowAction(action: WindowAction): Promise<void> {
  const win = getCurrentWindow();
  // The avail* properties exclude OS chrome (menu bar, dock).
  // availLeft / availTop are non-zero on multi-monitor or when the
  // dock is on the left.
  const availW = window.screen.availWidth;
  const availH = window.screen.availHeight;
  // availLeft/Top are non-standard but present in WebKit.
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
      // already sized to fill
      break;
    case "window-center": {
      // Center the current window without changing its size.
      const size = await win.outerSize();
      const scale = await win.scaleFactor();
      const logW = size.width / scale;
      const logH = size.height / scale;
      x = availLeft + Math.max(0, Math.floor((availW - logW) / 2));
      y = availTop + Math.max(0, Math.floor((availH - logH) / 2));
      w = logW;
      h = logH;
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
    id === "window-bottom-half"
  );
}
