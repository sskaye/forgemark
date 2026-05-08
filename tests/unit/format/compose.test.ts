import { describe, it, expect } from "vitest";
import { nextCommentId, insertMarkersIntoBody, contextSnippet } from "../../../src/format/compose";

describe("nextCommentId", () => {
  it("returns 1 for an empty file", () => {
    expect(nextCommentId([])).toBe(1);
  });
  it("returns max+1 when ids are contiguous", () => {
    const ids = [1, 2, 3].map((id) => makeComment(id));
    expect(nextCommentId(ids)).toBe(4);
  });
  it("returns max+1 when ids have gaps", () => {
    const ids = [1, 2, 5].map((id) => makeComment(id));
    expect(nextCommentId(ids)).toBe(6);
  });
  it("returns max+1 when there is one comment", () => {
    expect(nextCommentId([makeComment(7)])).toBe(8);
  });
});

describe("insertMarkersIntoBody", () => {
  it("wraps a single substring with paired markers", () => {
    const body = "foo bar baz";
    const out = insertMarkersIntoBody(body, 4, 7, 1);
    expect(out).toBe("foo <!-- fmc:1 -->bar<!-- /fmc:1 --> baz");
  });
  it("wraps an empty range (zero-width selection) cleanly", () => {
    const body = "abc";
    const out = insertMarkersIntoBody(body, 1, 1, 1);
    expect(out).toBe("a<!-- fmc:1 --><!-- /fmc:1 -->bc");
  });
  it("rejects an invalid range", () => {
    expect(() => insertMarkersIntoBody("foo", 4, 5, 1)).toThrow();
    expect(() => insertMarkersIntoBody("foo", -1, 2, 1)).toThrow();
    expect(() => insertMarkersIntoBody("foo", 3, 1, 1)).toThrow();
  });
});

describe("contextSnippet", () => {
  it("returns context_before trimmed at sentence boundary", () => {
    const before = "First sentence. Second sentence here.";
    expect(contextSnippet(before, "before")).toBe("Second sentence here.");
  });
  it("returns context_after trimmed at sentence boundary", () => {
    const after = "Hello world. More words to ignore here.";
    expect(contextSnippet(after, "after")).toBe("Hello world.");
  });
  it("returns the snippet trimmed when no sentence boundary is found", () => {
    expect(contextSnippet("abc", "before")).toBe("abc");
    expect(contextSnippet("abc", "after")).toBe("abc");
  });
  it("returns an empty string for an empty input", () => {
    expect(contextSnippet("", "before")).toBe("");
    expect(contextSnippet("", "after")).toBe("");
  });
});

function makeComment(id: number) {
  return {
    id,
    author: "x",
    timestamp: "2026-05-01T00:00:00Z",
    resolved: false,
    body: "x",
  };
}
