import { describe, it, expect } from "vitest";
import { cleanExport } from "../../src/format/cleanExport";
import { parseForgemarkFile } from "../../src/format";
import type { Comment } from "../../src/format/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("cleanExport", () => {
  it("strips marker pairs but keeps the anchored text", () => {
    const body = "before <!-- fmc:1 -->anchored<!-- /fmc:1 --> after";
    const comments: Comment[] = [
      {
        id: 1,
        author: "Maya",
        timestamp: "2026-05-07T09:00:00Z",
        resolved: false,
        anchor_text: "anchored",
        body: "ok\n",
      },
    ];
    expect(cleanExport(body, comments)).toBe("before anchored after");
  });

  it("removes markers for multiple comments", () => {
    const body = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->";
    const comments: Comment[] = [
      {
        id: 1,
        author: "A",
        timestamp: "2026-05-07T09:00:00Z",
        resolved: false,
        anchor_text: "one",
        body: "x\n",
      },
      {
        id: 2,
        author: "A",
        timestamp: "2026-05-07T09:00:00Z",
        resolved: false,
        anchor_text: "two",
        body: "x\n",
      },
    ];
    expect(cleanExport(body, comments)).toBe("one and two");
  });

  it("ignores floating notes (no markers to strip)", () => {
    const body = "plain prose";
    const comments: Comment[] = [
      {
        id: 1,
        floating: true,
        author: "A",
        timestamp: "2026-05-07T09:00:00Z",
        resolved: false,
        body: "general note\n",
      },
    ];
    expect(cleanExport(body, comments)).toBe("plain prose");
  });

  it("production sample-onboarding.md round-trips through cleanExport with no markers and no comments block", () => {
    const path = resolve(__dirname, "..", "..", "assets", "sample-onboarding.md");
    const text = readFileSync(path, "utf8");
    const parsed = parseForgemarkFile(text);
    const exported = cleanExport(parsed.body, parsed.comments);
    expect(exported).not.toMatch(/<!--\s*fmc:\d+\s*-->/);
    expect(exported).not.toMatch(/<!--\s*\/fmc:\d+\s*-->/);
    expect(exported).not.toContain("forgemark-comments");
    // Anchored phrases survive as plain prose.
    expect(exported).toContain("fourteen interviews with new enterprise customers");
    expect(exported).toContain("retained at roughly twice the rate");
  });
});
