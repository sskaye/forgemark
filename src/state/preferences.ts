// Phase 5: minimum-viable user preferences. Phase 11 ships a proper
// Settings window with author name, theme, font size, default view; for
// now we keep it tiny and localStorage-backed so the composer can attach
// the author to comments.

import { useEffect, useState } from "react";

const AUTHOR_KEY = "forgemark.author";
const DEFAULT_AUTHOR = "You";

function readAuthor(): string {
  if (typeof window === "undefined") return DEFAULT_AUTHOR;
  try {
    const stored = window.localStorage.getItem(AUTHOR_KEY);
    if (stored && stored.trim().length > 0) return stored;
  } catch {
    // localStorage may be unavailable (private mode, sandbox); fall through.
  }
  return DEFAULT_AUTHOR;
}

function writeAuthor(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTHOR_KEY, value);
  } catch {
    // localStorage may be unavailable; silently no-op.
  }
}

// Returns the current author name and a setter that persists to
// localStorage. Components re-render when the author changes.
export function useAuthorName(): [string, (next: string) => void] {
  const [author, setAuthorState] = useState<string>(readAuthor);
  const setAuthor = (next: string) => {
    setAuthorState(next);
    writeAuthor(next);
  };
  // Reflect cross-tab changes (a future Settings window may live in a
  // separate window in Phase 11).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTHOR_KEY && e.newValue) setAuthorState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [author, setAuthor];
}
