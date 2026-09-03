import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMock = vi.hoisted(() => ({
  readTextFile: vi.fn(() => Promise.resolve("disk\n")),
  stat: vi.fn(() => Promise.resolve({ mtime: new Date(1000) })),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-fs", () => fsMock);

import { watchMarkdownFile } from "../../src/services/fileWatcher";
import { fingerprint } from "../../src/services/conflict";

describe("watchMarkdownFile", () => {
  beforeEach(() => {
    for (const fn of Object.values(fsMock)) fn.mockClear();
  });

  // The plugin's debounced watch defaults to a two-second delay. That
  // is the window in which the app's own auto-save can overwrite an
  // external write before anyone notices, so it must be short.
  it("asks the plugin for a short delay, watching the parent directory", async () => {
    const baseline = await fingerprint("mem\n", null);
    await watchMarkdownFile(
      "/notes/draft.md",
      () => baseline,
      () => {},
    );
    const [dir, , opts] = fsMock.watch.mock.calls[0] as unknown as [
      string,
      unknown,
      { delayMs?: number; recursive?: boolean },
    ];
    expect(dir).toBe("/notes");
    expect(opts.recursive).toBe(false);
    expect(opts.delayMs).toBeDefined();
    expect(opts.delayMs!).toBeLessThanOrEqual(300);
  });

  it("fires only when the disk differs from the baseline", async () => {
    // Real timers: the hash runs on Web Crypto, which resolves on the
    // event loop rather than the microtask queue fake timers flush.
    const settle = () => new Promise((r) => setTimeout(r, 40));
    const onChange = vi.fn();
    const baseline = await fingerprint("mem\n", null);
    await watchMarkdownFile("/notes/draft.md", () => baseline, onChange, { debounceMs: 5 });
    const cb = (fsMock.watch.mock.calls[0] as unknown as [string, (e: unknown) => void])[1];

    fsMock.readTextFile.mockResolvedValue("mem\n");
    cb({ paths: ["/notes/draft.md"] });
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    fsMock.readTextFile.mockResolvedValue("disk\n");
    cb({ paths: ["/notes/draft.md"] });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].text).toBe("disk\n");

    // Events for other files in the directory are ignored.
    cb({ paths: ["/notes/other.md"] });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
