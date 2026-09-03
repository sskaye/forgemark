// An in-memory stand-in for the Tauri plugins every integration test
// needs, installed once from tests/setup.ts and reachable from any test
// through `fakeTauri`.
//
// Thirty test files used to carry an identical `vi.mock` block whose
// `readTextFile` returned undefined; the pre-write disk check was inert
// under it. This fake keeps real files: what a test seeds or the app
// writes is what a later read returns, and the atomic write (temp file
// plus rename) behaves as it does on disk. A test that needs different
// behaviour for one call adjusts the mock in place; a test that needs a
// different module entirely still declares its own `vi.mock`, which
// wins over this one.

import { vi } from "vitest";

type Entry = { text: string; bytes?: Uint8Array; mtimeMs: number };

export type FakeTauri = ReturnType<typeof createFakeTauri>;

export function createFakeTauri() {
  const files = new Map<string, Entry>();
  const watchers = new Map<string, Set<(event: unknown) => void>>();
  let clock = 1;

  const enoent = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });

  const fs = {
    readTextFile: vi.fn(async (path: string) => {
      const f = files.get(path);
      if (!f) throw enoent(path);
      return f.text;
    }),
    writeTextFile: vi.fn(async (path: string, text: string) => {
      files.set(path, { text, mtimeMs: clock++ });
    }),
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
      files.set(path, { text: "", bytes, mtimeMs: clock++ });
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const f = files.get(from);
      if (!f) throw enoent(from);
      files.delete(from);
      files.set(to, { ...f, mtimeMs: clock++ });
    }),
    remove: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    stat: vi.fn(async (path: string) => {
      const f = files.get(path);
      if (!f) throw enoent(path);
      return { isDirectory: false, isFile: true, readonly: false, mtime: new Date(f.mtimeMs) };
    }),
    lstat: vi.fn(async (path: string) => {
      const f = files.get(path);
      if (!f) throw enoent(path);
      return { isDirectory: false, isFile: true, isSymlink: false, readonly: false };
    }),
    exists: vi.fn(async (path: string) => files.has(path)),
    watch: vi.fn(async (dir: string, cb: (event: unknown) => void) => {
      const set = watchers.get(dir) ?? new Set();
      set.add(cb);
      watchers.set(dir, set);
      return () => {
        set.delete(cb);
      };
    }),
    watchImmediate: vi.fn(async () => () => {}),
  };

  const dialog = {
    open: vi.fn(async () => null as string | string[] | null),
    save: vi.fn(async () => null as string | null),
    ask: vi.fn(async () => false),
    message: vi.fn(async () => undefined),
  };

  const opener = { openUrl: vi.fn(async () => undefined) };
  const core = { invoke: vi.fn(async () => undefined as unknown) };

  return {
    fs,
    dialog,
    opener,
    core,
    // Put a file on the fake disk, as if another program had written it.
    seed(path: string, text: string) {
      files.set(path, { text, mtimeMs: clock++ });
    },
    read(path: string): string | undefined {
      return files.get(path)?.text;
    },
    // Tell every watcher of the file's directory that it changed.
    touch(path: string) {
      const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
      for (const cb of watchers.get(dir) ?? []) cb({ paths: [path], type: { modify: {} } });
    },
    reset() {
      files.clear();
      watchers.clear();
      clock = 1;
      for (const group of [fs, dialog, opener, core]) {
        for (const fn of Object.values(group)) (fn as { mockClear(): void }).mockClear();
      }
      dialog.open.mockImplementation(async () => null);
      dialog.save.mockImplementation(async () => null);
      dialog.ask.mockImplementation(async () => false);
      core.invoke.mockImplementation(async () => undefined);
    },
  };
}
