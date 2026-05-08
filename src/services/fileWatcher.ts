// File watching wrapper around tauri-plugin-fs's watch APIs.
//
// Phase 9 builds the watcher abstraction; Phase 10 wires the surfaces
// (banner, edit-during-open modal, save-conflict modal) on top.
//
// The wrapper hides the Tauri-specific event shape so tests can plug
// in a synthetic source. A watcher instance owns one path; switching
// files calls dispose() on the old watcher and opens a new one.

import { readTextFile, stat, watch } from "@tauri-apps/plugin-fs";
import { fingerprint, compareFingerprints, type FileFingerprint } from "./conflict";

export type WatcherEvent = {
  // The new bytes on disk after the change settled.
  text: string;
  fingerprint: FileFingerprint;
};

export type FileWatcher = {
  // Stop watching and release resources.
  dispose: () => Promise<void>;
};

export type WatcherOptions = {
  // Debounce window (ms). Editors save in bursts of events; we coalesce
  // them so a single save = one fire.
  debounceMs?: number;
};

// Watch a file. The callback fires only when the file's content
// (per the conflict pipeline) is meaningfully different from the
// fingerprint we recorded at the last read or save.
//
// The `baseline` argument is the fingerprint of the bytes we currently
// have in memory (i.e. what we last read/wrote). The watcher uses it
// to ignore re-fires triggered by our own writes.
export async function watchMarkdownFile(
  path: string,
  getBaseline: () => FileFingerprint,
  onChange: (e: WatcherEvent) => void,
  opts: WatcherOptions = {},
): Promise<FileWatcher> {
  const debounceMs = opts.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = async () => {
    if (disposed) return;
    timer = null;
    try {
      const text = await readTextFile(path);
      let mtimeMs: number | null = null;
      try {
        const s = await stat(path);
        const m = (s as { mtime?: Date | null }).mtime;
        mtimeMs = m instanceof Date ? m.getTime() : null;
      } catch {
        mtimeMs = null;
      }
      const fp = await fingerprint(text, mtimeMs);
      if (compareFingerprints(getBaseline(), fp) === "unchanged") return;
      onChange({ text, fingerprint: fp });
    } catch {
      // Read failures during a save are common (the file is briefly
      // truncated). Swallow and let the next event try again.
    }
  };

  const stopFn = await watch(
    path,
    () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    },
    { recursive: false },
  );

  return {
    async dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      try {
        await Promise.resolve(stopFn());
      } catch {
        // ignore — we're shutting down
      }
    },
  };
}
