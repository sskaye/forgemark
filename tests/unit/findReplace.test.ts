import { describe, expect, it } from "vitest";
import { findLiteralMatches } from "../../src/services/findReplace";

describe("findLiteralMatches", () => {
  it("finds literal matches case-insensitively by default", () => {
    expect(findLiteralMatches("Alpha beta alpha", "alpha")).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
  });

  it("can match case-sensitively", () => {
    expect(findLiteralMatches("Alpha beta alpha", "alpha", true)).toEqual([{ from: 11, to: 16 }]);
  });

  it("does not emit overlapping matches", () => {
    expect(findLiteralMatches("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("returns no matches for an empty query", () => {
    expect(findLiteralMatches("anything", "")).toEqual([]);
  });
});
