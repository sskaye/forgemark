// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSource, writeAtomic, nowIso, IoError } from "../../../cli/io";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forgemark-io-"));
});

afterEach(() => {
  try {
    chmodSync(dir, 0o755);
  } catch {
    // already writable
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("readSource", () => {
  it("reads text and decides the format from the extension", () => {
    const md = join(dir, "a.md");
    const html = join(dir, "b.HTML");
    writeFileSync(md, "# hi\n");
    writeFileSync(html, "<p>hi</p>\n");
    expect(readSource(md)).toEqual({ path: md, text: "# hi\n", format: "markdown" });
    expect(readSource(html).format).toBe("html");
  });

  it("throws an IoError for a missing file or a directory", () => {
    expect(() => readSource(join(dir, "missing.md"))).toThrow(IoError);
    expect(() => readSource(join(dir, "missing.md"))).toThrow(/No such file/);
    expect(() => readSource(dir)).toThrow(IoError);
  });
});

describe("writeAtomic", () => {
  it("replaces the file and leaves no temp file behind", () => {
    const path = join(dir, "doc.md");
    writeFileSync(path, "old\n");
    writeAtomic(path, "new\n");
    expect(readFileSync(path, "utf8")).toBe("new\n");
    expect(readdirSync(dir)).toEqual(["doc.md"]);
  });

  it("creates the file when it does not exist yet", () => {
    const path = join(dir, "fresh.md");
    writeAtomic(path, "x\n");
    expect(readFileSync(path, "utf8")).toBe("x\n");
  });

  it("fails as an IoError when the directory does not exist, touching nothing", () => {
    const path = join(dir, "nope", "doc.md");
    expect(() => writeAtomic(path, "x")).toThrow(IoError);
    expect(() => writeAtomic(path, "x")).toThrow(/Couldn't write/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("cleans up its temp file when the rename fails", () => {
    // A read-only directory: the temp file can't be created either, so
    // the guard has nothing to remove — but nothing may be left behind.
    // (Skipped as root, which ignores directory modes.)
    if (process.getuid?.() === 0 || process.platform === "win32") return;
    const path = join(dir, "doc.md");
    writeFileSync(path, "old\n");
    chmodSync(dir, 0o555);
    expect(() => writeAtomic(path, "new\n")).toThrow(IoError);
    chmodSync(dir, 0o755);
    expect(readFileSync(path, "utf8")).toBe("old\n");
    expect(readdirSync(dir)).toEqual(["doc.md"]);
  });
});

describe("nowIso", () => {
  it("is ISO 8601 UTC to the second, the shape the format specifies", () => {
    expect(nowIso(new Date("2026-09-03T21:49:43.117Z"))).toBe("2026-09-03T21:49:43Z");
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
