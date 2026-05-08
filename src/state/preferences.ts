// User preferences (Phase 11). Persisted to localStorage; mirrored
// across BroadcastChannel-style `storage` events so a future Settings
// window living in a separate Tauri window stays in sync with the main
// editor.

import { useEffect, useState } from "react";

const PREFIX = "forgemark.";
const KEY_AUTHOR = PREFIX + "author";
const KEY_THEME = PREFIX + "theme";
const KEY_FONT_SIZE = PREFIX + "fontSize";
const KEY_DEFAULT_VIEW = PREFIX + "defaultView";
const KEY_RECENT_FILES = PREFIX + "recentFiles";
const KEY_FIRST_RUN_DONE = PREFIX + "firstRunDone";

const DEFAULT_AUTHOR = "You";
const DEFAULT_THEME: ThemePreference = "system";
const DEFAULT_FONT_SIZE = 17;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 22;
const DEFAULT_VIEW: ViewPreference = "rendered";
const RECENT_FILES_LIMIT = 10;

export type ThemePreference = "light" | "dark" | "system";
export type ViewPreference = "rendered" | "source";

export type RecentFile = {
  path: string;
  fileName: string;
  // Most recent open time in ms since epoch — drives ordering.
  lastOpenedMs: number;
};

// ── Author name ───────────────────────────────────────────────────────

export function useAuthorName(): [string, (next: string) => void] {
  return useStringPref(KEY_AUTHOR, DEFAULT_AUTHOR);
}

// ── Theme ─────────────────────────────────────────────────────────────

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  return useEnumPref<ThemePreference>(
    KEY_THEME,
    DEFAULT_THEME,
    (v): v is ThemePreference => v === "light" || v === "dark" || v === "system",
  );
}

// ── Font size ─────────────────────────────────────────────────────────

export function useFontSize(): [number, (next: number) => void] {
  const [size, setSize] = useNumberPref(KEY_FONT_SIZE, DEFAULT_FONT_SIZE);
  const setClamped = (next: number) => {
    setSize(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(next))));
  };
  return [size, setClamped];
}

export const FONT_SIZE_RANGE = { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE };

// ── Default view ──────────────────────────────────────────────────────

export function useDefaultView(): [ViewPreference, (next: ViewPreference) => void] {
  return useEnumPref<ViewPreference>(
    KEY_DEFAULT_VIEW,
    DEFAULT_VIEW,
    (v): v is ViewPreference => v === "rendered" || v === "source",
  );
}

// ── Recent files ──────────────────────────────────────────────────────

function readRecentFiles(): RecentFile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(KEY_RECENT_FILES);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentFile =>
          e != null &&
          typeof e === "object" &&
          typeof e.path === "string" &&
          typeof e.fileName === "string" &&
          typeof e.lastOpenedMs === "number",
      )
      .slice(0, RECENT_FILES_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentFiles(list: RecentFile[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY_RECENT_FILES,
      JSON.stringify(list.slice(0, RECENT_FILES_LIMIT)),
    );
  } catch {
    // ignore
  }
}

export function useRecentFiles(): {
  recent: RecentFile[];
  recordOpened: (path: string, fileName: string) => void;
  remove: (path: string) => void;
  clear: () => void;
} {
  const [recent, setRecent] = useState<RecentFile[]>(readRecentFiles);

  // Cross-window sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_RECENT_FILES) setRecent(readRecentFiles());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Read from localStorage at call-time rather than closing over the
  // current `recent` state — that way rapid back-to-back calls (e.g.
  // batched in a single event handler) all see the freshest list.
  const recordOpened = (path: string, fileName: string) => {
    const now = Date.now();
    const current = readRecentFiles();
    const filtered = current.filter((f) => f.path !== path);
    const next = [{ path, fileName, lastOpenedMs: now }, ...filtered].slice(0, RECENT_FILES_LIMIT);
    setRecent(next);
    writeRecentFiles(next);
  };

  const remove = (path: string) => {
    const current = readRecentFiles();
    const next = current.filter((f) => f.path !== path);
    setRecent(next);
    writeRecentFiles(next);
  };

  const clear = () => {
    setRecent([]);
    writeRecentFiles([]);
  };

  return { recent, recordOpened, remove, clear };
}

// ── First-run flag ────────────────────────────────────────────────────

export function useFirstRun(): {
  firstRunDone: boolean;
  markDone: () => void;
} {
  const [done, setDone] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(KEY_FIRST_RUN_DONE) === "true";
    } catch {
      return true;
    }
  });
  const markDone = () => {
    setDone(true);
    try {
      window.localStorage.setItem(KEY_FIRST_RUN_DONE, "true");
    } catch {
      // ignore
    }
  };
  // Cross-window sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_FIRST_RUN_DONE) setDone(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { firstRunDone: done, markDone };
}

// ── Generic helpers ───────────────────────────────────────────────────

function readString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Same-tab pub/sub. localStorage only fires `storage` events across
// tabs, so two hooks that share a key in the same tab won't sync via
// that mechanism. We layer a tiny in-memory bus on top: writers
// publish, readers subscribe.
const subscribers = new Map<string, Set<(value: string) => void>>();

function subscribe(key: string, fn: (value: string) => void): () => void {
  let bucket = subscribers.get(key);
  if (!bucket) {
    bucket = new Set();
    subscribers.set(key, bucket);
  }
  bucket.add(fn);
  return () => {
    bucket?.delete(fn);
  };
}

function publish(key: string, value: string) {
  subscribers.get(key)?.forEach((fn) => fn(value));
}

function writeString(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  publish(key, value);
}

function useStringPref(key: string, fallback: string): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(() => {
    const stored = readString(key);
    return stored && stored.trim().length > 0 ? stored : fallback;
  });
  const set = (next: string) => {
    setValue(next);
    writeString(key, next);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) setValue(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    const unsub = subscribe(key, setValue);
    return () => {
      window.removeEventListener("storage", onStorage);
      unsub();
    };
  }, [key]);
  return [value, set];
}

function useEnumPref<T extends string>(
  key: string,
  fallback: T,
  validate: (v: unknown) => v is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readString(key);
    return stored && validate(stored) ? stored : fallback;
  });
  const set = (next: T) => {
    setValue(next);
    writeString(key, next);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue && validate(e.newValue)) {
        setValue(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    const unsub = subscribe(key, (v) => {
      if (validate(v)) setValue(v);
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      unsub();
    };
  }, [key, validate]);
  return [value, set];
}

function useNumberPref(key: string, fallback: number): [number, (next: number) => void] {
  const [value, setValue] = useState<number>(() => {
    const stored = readString(key);
    if (!stored) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : fallback;
  });
  const set = (next: number) => {
    setValue(next);
    writeString(key, String(next));
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        const parsed = Number(e.newValue);
        if (Number.isFinite(parsed)) setValue(parsed);
      }
    };
    window.addEventListener("storage", onStorage);
    const unsub = subscribe(key, (v) => {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) setValue(parsed);
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      unsub();
    };
  }, [key]);
  return [value, set];
}
