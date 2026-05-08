import { describe, it, expect } from "vitest";
import {
  getAnchorStatus,
  classifyAnchors,
  findCandidates,
  levenshtein,
} from "../../../src/format/reattach";
import type { Comment } from "../../../src/format/types";

function aComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    author: "Maya",
    timestamp: "2026-05-07T09:00:00Z",
    resolved: false,
    anchor_text: "fourteen interviews with new enterprise customers",
    body: "ok\n",
    ...overrides,
  };
}

describe("getAnchorStatus", () => {
  it("returns attached when both markers exist", () => {
    const body = "Across <!-- fmc:1 -->fourteen interviews<!-- /fmc:1 -->, …";
    const status = getAnchorStatus(body, aComment({ anchor_text: "fourteen interviews" }));
    expect(status.kind).toBe("attached");
    if (status.kind === "attached") {
      expect(body.slice(status.from, status.to)).toContain("<!-- fmc:1 -->");
    }
  });

  it("returns floating for floating: true comments", () => {
    const body = "no markers here";
    const status = getAnchorStatus(body, aComment({ floating: true, anchor_text: undefined }));
    expect(status.kind).toBe("floating");
  });

  it("returns orphaned when markers are missing", () => {
    const body = "no markers anywhere — fourteen interviews appear inline";
    const status = getAnchorStatus(body, aComment({ anchor_text: "fourteen interviews" }));
    expect(status.kind).toBe("orphaned");
    if (status.kind === "orphaned") {
      // Exact substring match → at least one candidate.
      expect(status.candidates.length).toBeGreaterThan(0);
      expect(status.candidates[0].rationale).toMatch(/exact/);
    }
  });

  it("returns orphaned with zero candidates when text is gone", () => {
    const body = "completely different prose now";
    const status = getAnchorStatus(
      body,
      aComment({ anchor_text: "fourteen interviews with new enterprise customers" }),
    );
    expect(status.kind).toBe("orphaned");
    if (status.kind === "orphaned") {
      // No exact match and the distinctive token "interviews" / "customers"
      // doesn't appear → no fuzzy candidates either.
      expect(status.candidates.length).toBe(0);
    }
  });
});

describe("findCandidates — exact + context", () => {
  it("ranks an exact match with both contexts above an exact match alone", () => {
    const body =
      "Across the year, fourteen interviews with new enterprise customers were run, and " +
      "later, fourteen interviews with new enterprise customers reappeared.";
    const c = aComment({
      anchor_text: "fourteen interviews with new enterprise customers",
      context_before: "Across the year,",
      context_after: "were run",
    });
    const candidates = findCandidates(body, c);
    expect(candidates.length).toBe(2);
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    expect(candidates[0].rationale).toBe("exact-with-context");
  });

  it("returns multiple exact matches when no context disambiguates", () => {
    const body = "alpha alpha alpha";
    const c = aComment({ anchor_text: "alpha" });
    const candidates = findCandidates(body, c);
    expect(candidates.length).toBe(3);
    for (const cand of candidates) {
      expect(cand.rationale).toBe("exact");
    }
  });
});

describe("findCandidates — fuzzy fallback", () => {
  it("matches a slightly drifted anchor when no exact substring exists", () => {
    const body =
      "We ran fourteen interviews with new enterprise customers last quarter. " +
      "Later, the team rewrote it as: fourteen conversations with new enterprise customers.";
    const c = aComment({
      anchor_text: "fourteen interviews with newer enterprise customers",
    });
    // anchor differs from body by one word; substring match fails, fuzzy
    // should still find the original phrasing.
    const candidates = findCandidates(body, c);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].rationale).toBe("fuzzy");
    expect(candidates[0].score).toBeGreaterThan(0.5);
    expect(candidates[0].score).toBeLessThanOrEqual(0.9);
  });

  it("returns no candidates when the anchor is too short for fuzzy", () => {
    // Anchor is below the 6-char fuzzy threshold AND has no exact substring.
    const c = aComment({ anchor_text: "qq" });
    const candidates = findCandidates("entirely different prose", c);
    expect(candidates).toHaveLength(0);
  });

  it("returns no candidates when no distinctive token appears", () => {
    const c = aComment({ anchor_text: "monolithic embedded subsystem" });
    const candidates = findCandidates("totally different prose here", c);
    expect(candidates).toHaveLength(0);
  });
});

describe("classifyAnchors", () => {
  it("classifies a mix of attached, floating, and orphaned in one pass", () => {
    const body =
      "Open <!-- fmc:1 -->the door<!-- /fmc:1 --> please. " + "Also: a careful note in the corner.";
    const comments: Comment[] = [
      aComment({ id: 1, anchor_text: "the door" }),
      aComment({
        id: 2,
        floating: true,
        anchor_text: undefined,
        body: "general\n",
      }),
      aComment({ id: 3, anchor_text: "a careful note in the corner" }),
    ];
    const map = classifyAnchors(body, comments);
    expect(map.get(1)?.kind).toBe("attached");
    expect(map.get(2)?.kind).toBe("floating");
    expect(map.get(3)?.kind).toBe("orphaned");
  });
});

describe("levenshtein", () => {
  it("zero distance for equal strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("one insertion / deletion / substitution = distance 1", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
    expect(levenshtein("abc", "ab")).toBe(1);
    expect(levenshtein("abc", "abd")).toBe(1);
  });
  it("handles empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("performance: 50k-word body, 50 orphans, < 2s", () => {
  it("classifies 50 orphans in under 2 seconds", () => {
    // Build a 50k-word body of synthetic prose. Roughly 6 chars / word
    // with spaces gives ~300k chars.
    const wordPool = [
      "interview",
      "customer",
      "retention",
      "kickoff",
      "engineer",
      "tutorial",
      "session",
      "predictor",
      "cohort",
      "onboarding",
      "rollout",
      "checkpoint",
      "pipeline",
      "telemetry",
      "experiment",
    ];
    const words: string[] = [];
    for (let i = 0; i < 50000; i++) {
      words.push(wordPool[i % wordPool.length]);
    }
    const body = words.join(" ");

    // 50 anchors that don't appear verbatim (force the fuzzy path).
    const comments: Comment[] = [];
    for (let i = 0; i < 50; i++) {
      comments.push(
        aComment({
          id: i + 1,
          anchor_text: "interviews customers retention kickoff " + i,
        }),
      );
    }

    const t0 = performance.now();
    const map = classifyAnchors(body, comments);
    const ms = performance.now() - t0;
    expect(map.size).toBe(50);
    expect(ms).toBeLessThan(2000);
  });
});
