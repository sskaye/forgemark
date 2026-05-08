import { describe, it, expect } from "vitest";
import { escapeContent, unescapeContent } from "../../../src/format/escape";

describe("escape / unescape", () => {
  it("escapes -->", () => {
    expect(escapeContent("see -->")).toBe("see --\\>");
  });
  it("escapes <!--", () => {
    expect(escapeContent("see <!-- foo")).toBe("see <!\\-- foo");
  });
  it("is symmetric on round-trip", () => {
    const samples = [
      "no special",
      "before --> middle",
      "before <!-- middle -->",
      "<!-- ignore --> arrows",
      "multi\nline\n--> chunk",
      "",
    ];
    for (const s of samples) {
      expect(unescapeContent(escapeContent(s))).toBe(s);
    }
  });
  it("does not double-escape already-safe content", () => {
    const safe = "this is safe content with no specials";
    expect(escapeContent(safe)).toBe(safe);
    expect(unescapeContent(safe)).toBe(safe);
  });
});
