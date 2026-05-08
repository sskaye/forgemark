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
