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
  // Directories made with mkdir; a file's parents count as directories too.
  const dirs = new Set<string>();
  const watchers = new Map<string, Set<(event: unknown) => void>>();
  let clock = 1;

  const enoent = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  const isDir = (p: string) => {
    const d = norm(p);
    if (dirs.has(d)) return true;
    for (const f of files.keys()) if (f.startsWith(d + "/")) return true;
    for (const x of dirs) if (x.startsWith(d + "/")) return true;
    return false;
  };

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
        if (f) {
          files.delete(from);
          files.set(to, { ...f, mtimeMs: clock++ });
          return;
        }
        const d = norm(from);
        if (!isDir(d)) throw enoent(from);
        const target = norm(to);
        if (isDir(target))
          throw Object.assign(new Error(`ENOTEMPTY: ${to}`), { code: "ENOTEMPTY" });
        for (const [k, v] of [...files]) {
          if (k.startsWith(d + "/")) {
            files.delete(k);
            files.set(target + k.slice(d.length), v);
          }
        }
        for (const x of [...dirs]) {
          if (x === d || x.startsWith(d + "/")) {
            dirs.delete(x);
            dirs.add(target + x.slice(d.length));
          }
        }
      },
      remove: async (path: string, opts?: { recursive?: boolean }) => {
        if (files.delete(path)) return;
        const d = norm(path);
        if (!isDir(d)) throw enoent(path);
        const children = [...files.keys()].some((k) => k.startsWith(d + "/"));
        if (children && !opts?.recursive) {
          throw Object.assign(new Error(`ENOTEMPTY: ${path}`), { code: "ENOTEMPTY" });
        }
        for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
        for (const x of [...dirs]) if (x === d || x.startsWith(d + "/")) dirs.delete(x);
      },
      mkdir: async (path: string, opts?: { recursive?: boolean }) => {
        const d = norm(path);
        const parent = d.slice(0, d.lastIndexOf("/"));
        if (parent && !isDir(parent) && !opts?.recursive) throw enoent(parent);
        dirs.add(d);
      },
      readDir: async (path: string) => {
        const d = norm(path);
        if (!isDir(d)) throw enoent(path);
        const names = new Map<string, boolean>();
        for (const k of files.keys()) {
          if (!k.startsWith(d + "/")) continue;
          const rest = k.slice(d.length + 1);
          const slash = rest.indexOf("/");
          if (slash < 0) names.set(rest, false);
          else names.set(rest.slice(0, slash), true);
        }
        for (const x of dirs) {
          if (!x.startsWith(d + "/")) continue;
          const rest = x.slice(d.length + 1);
          const slash = rest.indexOf("/");
          names.set(slash < 0 ? rest : rest.slice(0, slash), true);
        }
        return [...names].map(([name, isDirectory]) => ({
          name,
          isDirectory,
          isFile: !isDirectory,
          isSymlink: false,
        }));
      },
      stat: async (path: string) => {
        const f = files.get(path);
        if (f)
          return { isDirectory: false, isFile: true, readonly: false, mtime: new Date(f.mtimeMs) };
        if (isDir(path))
          return { isDirectory: true, isFile: false, readonly: false, mtime: new Date(0) };
        throw enoent(path);
      },
      lstat: async (path: string) => {
        const f = files.get(path);
        if (f) return { isDirectory: false, isFile: true, isSymlink: false, readonly: false };
        if (isDir(path))
          return { isDirectory: true, isFile: false, isSymlink: false, readonly: false };
        throw enoent(path);
      },
      exists: async (path: string) => files.has(path) || isDir(path),
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
    opener: { openUrl: async () => undefined, openPath: async () => undefined },
    path: {
      homeDir: async () => "/home/tester/",
      appDataDir: async () => "/home/tester/Library/Application Support/forgemark/",
    },
    core: {
      invoke: async () => undefined as unknown,
      convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
    },
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
  const path = mockAll(defaults.path);

  const restore = () => {
    for (const [group, impls] of [
      [fs, defaults.fs],
      [dialog, defaults.dialog],
      [opener, defaults.opener],
      [core, defaults.core],
      [path, defaults.path],
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
    path,
    // Make a directory on the fake disk, parents included.
    mkdir(path: string) {
      dirs.add(norm(path));
    },
    // Every file under a directory, by full path.
    list(dir: string): string[] {
      const d = norm(dir);
      return [...files.keys()].filter((k) => k.startsWith(d + "/")).sort();
    },
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
      dirs.clear();
      watchers.clear();
      clock = 1;
      // A one-shot implementation a test queued and never consumed must
      // not fire in the next test: reset every mock and put the default
      // behaviour back.
      restore();
    },
  };
}
