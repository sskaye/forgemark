// A stand-in for Tauri's bridge, for running the app in a plain browser.
//
// The app reaches the native side through `window.__TAURI_INTERNALS__`.
// This installs one that answers from the page: files are read from
// disk through Vite's `/@fs/` route and written to an in-memory overlay
// the test can inspect, reports are kept for a blob-URL frame, dialogs
// answer nothing, and the rest is accepted and ignored. It is installed
// with `page.addInitScript`, so it must not reach outside itself.

export type E2EState = {
  files: Record<string, string>;
  writes: { path: string; text: string }[];
  opened: { kind: "url" | "path"; target: string }[];
  reports: Record<string, string>;
};

export function installTauriShim(): void {
  type Handler = (args: unknown, options?: { headers?: Record<string, string> }) => unknown;
  const state: E2EState & { reportUrl(id: string): string } = {
    files: {},
    writes: [],
    opened: [],
    reports: {},
    reportUrl(id: string) {
      const html = state.reports[id] ?? "<p>no such report</p>";
      return URL.createObjectURL(new Blob([html], { type: "text/html" }));
    },
  };
  (window as unknown as { __forgemark_e2e: typeof state }).__forgemark_e2e = state;

  let callbackId = 0;
  const callbacks = new Map<number, (payload: unknown) => void>();
  const text = (bytes: unknown) => new TextDecoder().decode(bytes as Uint8Array);
  const pathOf = (args: unknown) => String((args as { path: string }).path);

  const readDisk = async (path: string): Promise<string | null> => {
    const res = await fetch("/@fs" + path);
    return res.ok ? res.text() : null;
  };
  const statOf = (size: number) => ({
    isFile: true,
    isDirectory: false,
    isSymlink: false,
    size,
    mtime: 1_700_000_000_000,
    atime: 1_700_000_000_000,
    birthtime: 1_700_000_000_000,
    readonly: false,
    fileAttributes: null,
    dev: null,
    ino: null,
    mode: null,
    nlink: null,
    uid: null,
    gid: null,
    rdev: null,
    blksize: null,
    blocks: null,
  });

  const handlers: Record<string, Handler> = {
    "plugin:fs|read_text_file": async (args) => {
      const path = pathOf(args);
      const content = state.files[path] ?? (await readDisk(path));
      if (content == null) throw new Error(`No such file: ${path}`);
      return new TextEncoder().encode(content).buffer;
    },
    "plugin:fs|write_text_file": (args, options) => {
      const path = decodeURIComponent(options?.headers?.path ?? "");
      const content = text(args);
      state.files[path] = content;
      state.writes.push({ path, text: content });
      return null;
    },
    "plugin:fs|write_file": () => null,
    "plugin:fs|stat": async (args) => {
      const path = pathOf(args);
      const content = state.files[path] ?? (await readDisk(path));
      if (content == null) throw new Error(`No such file: ${path}`);
      return statOf(content.length);
    },
    "plugin:fs|exists": async (args) => {
      const path = pathOf(args);
      return path in state.files || (await readDisk(path)) != null;
    },
    "plugin:fs|rename": (args) => {
      const { oldPath, newPath } = args as { oldPath: string; newPath: string };
      if (oldPath in state.files) {
        state.files[newPath] = state.files[oldPath];
        delete state.files[oldPath];
      }
      return null;
    },
    "plugin:fs|remove": (args) => {
      delete state.files[pathOf(args)];
      return null;
    },
    "plugin:fs|watch": () => 1,
    "plugin:fs|unwatch": () => null,
    "plugin:event|listen": () => ++callbackId,
    "plugin:event|unlisten": () => null,
    "plugin:event|emit": () => null,
    "plugin:event|emit_to": () => null,
    "plugin:dialog|open": () => null,
    "plugin:dialog|save": () => null,
    "plugin:dialog|message": () => null,
    "plugin:dialog|ask": () => false,
    "plugin:opener|open_url": (args) => {
      state.opened.push({ kind: "url", target: String((args as { url: string }).url) });
      return null;
    },
    "plugin:opener|open_path": (args) => {
      state.opened.push({ kind: "path", target: String((args as { path: string }).path) });
      return null;
    },
    take_pending_files: () => [],
    set_recent_files: () => null,
    approve_exit: () => null,
    print_current_webview: () => {
      throw new Error("no printer in a browser");
    },
    set_report: (args) => {
      const { id, html } = args as { id: string; html: string };
      state.reports[id] = html;
      return null;
    },
    clear_report: (args) => {
      delete state.reports[(args as { id: string }).id];
      return null;
    },
  };
  handlers["plugin:fs|lstat"] = handlers["plugin:fs|stat"];

  const internals = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    plugins: {},
    async invoke(cmd: string, args: unknown, options?: { headers?: Record<string, string> }) {
      const handler = handlers[cmd];
      if (handler) return handler(args, options);
      if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
      throw new Error(`e2e shim: unhandled command ${cmd}`);
    },
    transformCallback(callback: (payload: unknown) => void) {
      const id = ++callbackId;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    runCallback(id: number, payload: unknown) {
      callbacks.get(id)?.(payload);
    },
    convertFileSrc(path: string) {
      return "/@fs" + path;
    },
  };
  (window as unknown as { __TAURI_INTERNALS__: typeof internals }).__TAURI_INTERNALS__ = internals;
  (
    window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: object }
  ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.localStorage.setItem("forgemark.firstRunDone", "true");
}
