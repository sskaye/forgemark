// File watching wrapper around tauri-plugin-fs's watch APIs.
//
// Phase 9 builds the watcher abstraction; Phase 10 wires the surfaces
// (banner, edit-during-open modal, save-conflict modal) on top.
//
// We watch the file's parent directory rather than the file itself.
// Most macOS editors save atomically — write to a temp file, rename
// over the original — which destroys the inode the file watcher was
// bound to. Watching the parent directory and filtering by filename
// catches those events reliably (the rename is just another event in
// the dir). This pattern is also what notify-rs's own examples
// recommend for "watch a single file" use cases.

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
  const debounceMs = opts.debounceMs ?? 200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = async () => {
    if (disposed) return;
    timer = null;
    try {
      const snap = await snapshotFile(path);
      if (compareFingerprints(getBaseline(), snap.fingerprint) === "unchanged") return;
      onChange(snap);
    } catch (err) {
      // Read failures during a save are common (the file is briefly
      // truncated or replaced). Log to the console so debugging is
      // possible, but don't surface — the next event will retry.
      console.warn("[forgemark] watcher read failed; will retry", err);
    }
  };

  // Watch the parent directory so atomic-saves (rename-over-original)
  // don't destroy our subscription. Filter events by filename.
  const parentDir = parentDirOf(path);
  const fileName = baseNameOf(path);

  // Tauri's watch callback receives events in `notify` format. We
  // don't strictly need the payload — we re-read the file on every
  // settled event — but we do filter so that unrelated changes in
  // the parent dir don't trigger an extra read.
  const stopFn = await watch(
    parentDir,
    (event) => {
      if (disposed) return;
      if (!eventTouchesFile(event, fileName)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    },
    // The plugin debounces on its own, with a two-second default. That
    // was the window in which the app's auto-save could overwrite an
    // external change before it was ever reported; keep it short and
    // let our own debounce below coalesce the burst.
    { recursive: false, delayMs: 200 },
  );
  // Confirm the subscription succeeded — if you don't see this in
  // the console after opening a file, the watcher never started.
  console.info(`[forgemark] watching ${parentDir} for changes to ${fileName}`);

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

// The file as it is on disk right now: its bytes and their fingerprint.
// Used by the watcher when an event settles, and by every write path
// before it writes — the watcher is debounced, so "nothing reported yet"
// is not the same as "nothing changed".
export async function snapshotFile(path: string): Promise<WatcherEvent> {
  const text = await readTextFile(path);
  if (typeof text !== "string") throw new Error(`Couldn't read ${path}`);
  return { text, fingerprint: await fingerprint(text, await mtimeOf(path)) };
}

// The file's mtime in ms, or null when it can't be read. Carried in the
// baseline so the comparison can skip hashing when nothing was touched.
export async function mtimeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    const m = (s as { mtime?: Date | null }).mtime;
    return m instanceof Date ? m.getTime() : null;
  } catch {
    return null;
  }
}

function parentDirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx < 0) return ".";
  if (idx === 0) return "/"; // root
  return p.slice(0, idx);
}

function baseNameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

// notify's event payload varies by platform but always includes a
// `paths` array. We accept anything with a paths field and filter on
// suffix match (the file we care about lives somewhere in the dir).
function eventTouchesFile(event: unknown, fileName: string): boolean {
  if (!event || typeof event !== "object") return true; // be permissive
  const paths = (event as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return true;
  return paths.some(
    (p) =>
      typeof p === "string" &&
      (p === fileName || p.endsWith("/" + fileName) || p.endsWith("\\" + fileName)),
  );
}
