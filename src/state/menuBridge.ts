// Menu bridge (Phase 11). The native Rust menu emits a single
// `forgemark:menu` Tauri event with the menu-item id as the payload.
// This module subscribes to that event and re-dispatches it as a DOM
// CustomEvent so the rest of the app — keyboard handlers, AppShell
// state, DocumentBindings — can listen with one mechanism regardless
// of whether the trigger came from the menu or from a keyboard
// shortcut. The rationale is reuse: every command already exists as
// either a keyboard shortcut or a state action; the menu just needs
// to fan into the same path.
//
// In tests the Tauri event API is mocked (or absent) and the harness
// dispatches the DOM event directly. That's why we bridge through the
// DOM rather than calling reducers from this module: tests get the
// same surface area as production without needing a Tauri runtime.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Many menu ids map straight to a keyboard shortcut. Rather than
// duplicate the keyboard handler logic, we synthesize a keydown event
// that the existing handlers already listen for. This keeps the
// command surface single-sourced.
const SYNTHESIZE_AS_KEYDOWN: Record<string, KeyboardEventInit> = {
  new: { key: "n", metaKey: true },
  open: { key: "o", metaKey: true },
  save: { key: "s", metaKey: true },
  "save-as": { key: "s", metaKey: true, shiftKey: true },
  "new-comment": { key: "m", metaKey: true, altKey: true },
  "suggest-edit": { key: "e", metaKey: true, altKey: true },
};

// App-level ids dispatched as `forgemark:menu` DOM CustomEvents so
// the AppShell can react. Tight set — only commands that aren't
// already a keyboard shortcut.
const APP_LEVEL_IDS = new Set(["settings", "clean-export"]);

export async function startMenuBridge(): Promise<UnlistenFn | null> {
  // listen() will throw or hang if the Tauri runtime isn't present
  // (e.g. running in a browser dev server). We return null so callers
  // can gracefully no-op.
  try {
    return await listen<string>("forgemark:menu", (event) => {
      route(event.payload);
    });
  } catch {
    return null;
  }
}

export function route(id: string) {
  if (typeof window === "undefined") return;
  const keyInit = SYNTHESIZE_AS_KEYDOWN[id];
  if (keyInit) {
    window.dispatchEvent(new KeyboardEvent("keydown", keyInit));
    return;
  }
  if (APP_LEVEL_IDS.has(id)) {
    window.dispatchEvent(new CustomEvent("forgemark:menu", { detail: id }));
    return;
  }
  // Unknown id — log so the engineering side notices a missing route.
  console.warn(`[forgemark] unknown menu id: ${id}`);
}
