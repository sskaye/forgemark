import { useEffect, useState } from "react";
import type { DocumentWidth } from "../state/preferences";

// The document column's width, as the page applies it. The preference
// (src/state/preferences.ts) is what is remembered; this is what the
// title bar's control and the column's edge handles drive while the
// reader drags, without re-rendering the app on every pointer move.
//
// EditorPane.css reads two things off the root: `data-doc-width`
// ("full", or "measure" with `--fm-doc-chars` characters) and
// `--fm-char-width`, the prose font's average character width, which
// `measureCharWidth` takes from a sample of ordinary text. A measure in
// average characters, rather than CSS `ch` (the width of a "0", well
// wider than most letters), means 70 holds about 70 characters of prose.

export function applyDocumentWidth(width: DocumentWidth): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  keepReadingPosition(() => {
    if (width === "full") {
      root.dataset.docWidth = "full";
      root.style.removeProperty("--fm-doc-chars");
    } else {
      root.dataset.docWidth = "measure";
      root.style.setProperty("--fm-doc-chars", String(width));
    }
  });
}

// ── Live preview ──────────────────────────────────────────────────────

type Listener = (width: DocumentWidth | null) => void;
const listeners = new Set<Listener>();

// Show a width without remembering it; the control and the handles
// both follow it. `endDocumentWidthPreview` hands back to the preference.
export function previewDocumentWidth(width: DocumentWidth): void {
  applyDocumentWidth(width);
  listeners.forEach((fn) => fn(width));
}

export function endDocumentWidthPreview(): void {
  listeners.forEach((fn) => fn(null));
}

// The width being previewed, or null when none is.
export function useDocumentWidthPreview(): DocumentWidth | null {
  const [preview, setPreview] = useState<DocumentWidth | null>(null);
  useEffect(() => {
    listeners.add(setPreview);
    return () => {
      listeners.delete(setPreview);
    };
  }, []);
  return preview;
}

// ── Character width ───────────────────────────────────────────────────

const SAMPLE =
  "The quick brown fox jumps over the lazy dog. Most lines of prose are " +
  "made of short words like these, with a comma, a figure or two (42), " +
  "and the occasional Capital.";

export function measureCharWidth(): void {
  if (typeof document === "undefined") return;
  const probe = document.createElement("span");
  probe.textContent = SAMPLE;
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "nowrap",
    fontFamily: "var(--fm-prose)",
    fontSize: "var(--fm-font-size, 17px)",
    letterSpacing: "var(--fm-prose-letterspacing)",
  });
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  // No layout (a test's DOM): leave the stylesheet's 0.5em estimate.
  if (width > 0) {
    document.documentElement.style.setProperty(
      "--fm-char-width",
      (width / SAMPLE.length).toFixed(3) + "px",
    );
  }
}

// The measured width in px, or the stylesheet's estimate.
export function charWidthPx(): number {
  const root = document.documentElement;
  const measured = parseFloat(getComputedStyle(root).getPropertyValue("--fm-char-width"));
  if (Number.isFinite(measured) && measured > 0) return measured;
  const size = parseFloat(getComputedStyle(root).getPropertyValue("--fm-font-size"));
  return (Number.isFinite(size) && size > 0 ? size : 17) * 0.5;
}

// ── Reading position ──────────────────────────────────────────────────

// Resizing the column reflows every line. Keep the line at the top of
// the pane where it was: find the block there, note how far into it the
// pane's top edge falls, and after the change scroll so the same point
// of the block is at the top again.
function keepReadingPosition(change: () => void): void {
  const pane = visiblePane();
  if (!pane || pane.scrollTop === 0) {
    change();
    return;
  }
  const top = pane.getBoundingClientRect().top;
  const block = blockAt(pane, top);
  if (!block) {
    change();
    return;
  }
  const before = block.getBoundingClientRect();
  const fraction = before.height > 0 ? (top - before.top) / before.height : 0;
  change();
  const after = block.getBoundingClientRect();
  pane.scrollTop += after.top + fraction * after.height - top;
}

function visiblePane(): HTMLElement | null {
  const panes = document.querySelectorAll<HTMLElement>(".fm-editor-pane");
  for (const pane of panes) if (pane.getClientRects().length > 0) return pane;
  return null;
}

// The top-level block (an editor paragraph, a source line) that spans
// `y`, by binary search: the blocks are in document order.
function blockAt(pane: HTMLElement, y: number): HTMLElement | null {
  const blocks = pane.querySelectorAll<HTMLElement>(".ProseMirror > *, .cm-line");
  let lo = 0;
  let hi = blocks.length - 1;
  let found: HTMLElement | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rect = blocks[mid].getBoundingClientRect();
    if (rect.bottom <= y) lo = mid + 1;
    else {
      found = blocks[mid];
      hi = mid - 1;
    }
  }
  return found;
}
