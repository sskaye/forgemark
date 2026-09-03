import { describe, it, expect } from "vitest";
import { basename, isMarkdownPath } from "../../src/services/fileIO";

describe("basename", () => {
  it("handles posix paths", () => {
    expect(basename("/Users/me/notes/draft.md")).toBe("draft.md");
  });
  it("handles windows paths", () => {
    expect(basename("C:\\Users\\me\\notes\\draft.md")).toBe("draft.md");
  });
  it("handles bare filenames", () => {
    expect(basename("untitled.md")).toBe("untitled.md");
  });
});

describe("isMarkdownPath", () => {
  it("accepts .md and .markdown", () => {
    expect(isMarkdownPath("a.md")).toBe(true);
    expect(isMarkdownPath("/x/y.markdown")).toBe(true);
    expect(isMarkdownPath("FOO.MD")).toBe(true);
  });
  it("rejects other extensions", () => {
    expect(isMarkdownPath("a.txt")).toBe(false);
    expect(isMarkdownPath("a")).toBe(false);
    expect(isMarkdownPath("a.mdx")).toBe(false);
  });
});

// ── saveDocument: atomic writes ───────────────────────────────────────

import { vi, beforeEach } from "vitest";

const fsMock = vi.hoisted(() => ({
  writeTextFile: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  lstat: vi.fn(() => Promise.resolve({ isSymlink: false })),
  remove: vi.fn(() => Promise.resolve()),
  readTextFile: vi.fn(() => Promise.resolve("")),
  stat: vi.fn(() => Promise.resolve({ isDirectory: false, readonly: false })),
}));
vi.mock("@tauri-apps/plugin-fs", () => fsMock);
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { saveDocument } from "../../src/services/fileIO";

describe("saveDocument", () => {
  beforeEach(() => {
    for (const fn of Object.values(fsMock)) fn.mockClear();
    fsMock.lstat.mockResolvedValue({ isSymlink: false });
    fsMock.rename.mockResolvedValue(undefined);
  });

  // A reader that opens the file mid-write — the CLI's lint, or the
  // agent's own watcher — must see the old bytes or the new ones, never
  // a truncated file. Write beside the target and rename into place.
  it("writes through a temp file in the same directory, then renames it into place", async () => {
    await saveDocument("/notes/draft.md", "new\n");
    const [tmp, text] = fsMock.writeTextFile.mock.calls[0] as unknown as [string, string];
    expect(tmp).toMatch(/^\/notes\/\.draft\.md\.[^/]+\.tmp$/);
    expect(text).toBe("new\n");
    expect(fsMock.rename).toHaveBeenCalledWith(tmp, "/notes/draft.md");
    expect(fsMock.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
      fsMock.rename.mock.invocationCallOrder[0],
    );
  });

  it("writes in place when the target is a symlink, so the link is kept", async () => {
    fsMock.lstat.mockResolvedValue({ isSymlink: true });
    await saveDocument("/notes/linked.md", "x\n");
    expect(fsMock.writeTextFile).toHaveBeenCalledWith("/notes/linked.md", "x\n");
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  it("removes the temp file and rethrows when the rename fails", async () => {
    fsMock.rename.mockRejectedValue(new Error("EPERM"));
    await expect(saveDocument("/notes/draft.md", "x\n")).rejects.toThrow(/EPERM/);
    const [tmp] = fsMock.writeTextFile.mock.calls[0] as unknown as [string];
    expect(fsMock.remove).toHaveBeenCalledWith(tmp);
  });

  it("handles Windows paths", async () => {
    await saveDocument("C:\\notes\\draft.md", "x\n");
    const [tmp] = fsMock.writeTextFile.mock.calls[0] as unknown as [string];
    expect(tmp).toMatch(/^C:\\notes\\\.draft\.md\..+\.tmp$/);
    expect(fsMock.rename).toHaveBeenCalledWith(tmp, "C:\\notes\\draft.md");
  });
});
