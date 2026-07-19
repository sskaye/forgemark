// Session restore: which documents were open last time.
//
// Only documents with a path on disk are remembered. Unsaved Untitled
// buffers are deliberately not persisted — that would mean stashing
// document *content* in localStorage, which is a different and riskier
// proposition (size limits, staleness against the real file, a second
// copy of review data living outside the markdown). The unsaved-work
// guard already forces those buffers to be saved or explicitly discarded
// before the app can quit, so nothing is lost by leaving them out.
//
// Paths are stored, not contents: on launch the files are re-read from
// disk, so a document edited outside Forgemark comes back current rather
// than stale.

export const SESSION_KEY = "forgemark.session";
const KEY = SESSION_KEY;

export type SessionSnapshot = {
  paths: string[];
  // Index into `paths` of the document that was active. -1 when the
  // active document had no path (an Untitled buffer), in which case
  // restore just focuses the last file.
  activeIndex: number;
};

export function readSession(): SessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { paths, activeIndex } = parsed as Partial<SessionSnapshot>;
    if (!Array.isArray(paths)) return null;
    const clean = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
    if (clean.length === 0) return null;
    return {
      paths: clean,
      activeIndex: typeof activeIndex === "number" ? activeIndex : -1,
    };
  } catch {
    // Corrupt or unreadable session data is not worth surfacing to the
    // user — starting on a blank document is a fine fallback.
    return null;
  }
}

export function writeSession(snapshot: SessionSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    if (snapshot.paths.length === 0) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full or disabled. Losing session restore is not worth
    // interrupting anyone over.
  }
}
