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

  // Default behaviour, kept apart from the mocks so `reset()` can put it
  // back: in this Vitest, mockReset() leaves a mock returning undefined.
  const defaults = {
    fs: {
      readTextFile: async (path: string) => {
        const f = files.get(path);
        if (!f) throw enoent(path);
        return f.text;
      },
      writeTextFile: async (path: string, text: string) => {
        files.set(path, { text, mtimeMs: clock++ });
      },
      writeFile: async (path: string, bytes: Uint8Array) => {
        files.set(path, { text: "", bytes, mtimeMs: clock++ });
      },
      rename: async (from: string, to: string) => {
        const f = files.get(from);
        if (!f) throw enoent(from);
        files.delete(from);
        files.set(to, { ...f, mtimeMs: clock++ });
      },
      remove: async (path: string) => {
        files.delete(path);
      },
      stat: async (path: string) => {
        const f = files.get(path);
        if (!f) throw enoent(path);
        return { isDirectory: false, isFile: true, readonly: false, mtime: new Date(f.mtimeMs) };
      },
      lstat: async (path: string) => {
        const f = files.get(path);
        if (!f) throw enoent(path);
        return { isDirectory: false, isFile: true, isSymlink: false, readonly: false };
      },
      exists: async (path: string) => files.has(path),
      watch: async (dir: string, cb: (event: unknown) => void) => {
        const set = watchers.get(dir) ?? new Set();
        set.add(cb);
        watchers.set(dir, set);
        return () => {
          set.delete(cb);
        };
      },
      watchImmediate: async () => () => {},
    },
    dialog: {
      open: async () => null as string | string[] | null,
      save: async () => null as string | null,
      ask: async () => false,
      message: async () => undefined,
    },
    opener: { openUrl: async () => undefined },
    core: { invoke: async () => undefined as unknown },
  };

  type Mocked<T> = {
    [K in keyof T]: T[K] extends (...a: infer A) => infer R
      ? ReturnType<typeof vi.fn<(...a: A) => R>>
      : never;
  };
  const mockAll = <T extends Record<string, (...a: never[]) => unknown>>(group: T): Mocked<T> =>
    Object.fromEntries(
      Object.entries(group).map(([k, impl]) => [k, vi.fn(impl as (...a: never[]) => unknown)]),
    ) as Mocked<T>;

  const fs = mockAll(defaults.fs);
  const dialog = mockAll(defaults.dialog);
  const opener = mockAll(defaults.opener);
  const core = mockAll(defaults.core);

  const restore = () => {
    for (const [group, impls] of [
      [fs, defaults.fs],
      [dialog, defaults.dialog],
      [opener, defaults.opener],
      [core, defaults.core],
    ] as const) {
      for (const [k, impl] of Object.entries(impls)) {
        const fn = (group as Record<string, ReturnType<typeof vi.fn>>)[k];
        fn.mockReset();
        fn.mockImplementation(impl as (...a: unknown[]) => unknown);
      }
    }
  };

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
      // A one-shot implementation a test queued and never consumed must
      // not fire in the next test: reset every mock and put the default
      // behaviour back.
      restore();
    },
  };
}
