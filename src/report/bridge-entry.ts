// The script injected into every report: install the bridge as soon as
// the document exists, speaking to the window that holds the frame.
import { installBridge, parentChannel } from "./bridge";

if (typeof window !== "undefined" && window.parent !== window) {
  const start = () => installBridge(window, parentChannel(window));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
