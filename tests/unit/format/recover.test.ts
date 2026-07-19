// Bug 4 / fail-soft: recoverForgemarkFile salvages comments from a file
// that strict parseForgemarkFile would reject wholesale, so one damaged
// anchor no longer hides every comment.

import { describe, it, expect } from "vitest";
import { recoverForgemarkFile } from "../../../src/format/parser";
import { parseForgemarkFile } from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import { getAnchorStatus } from "../../../src/format/reattach";
import type { Comment } from "../../../src/format/types";

function rec(id: number, anchor: string): Comment {
  return {
    id,
    anchor_text: anchor,
    context_before: "",
    context_after: "",
    author: "T",
    timestamp: "2026-06-21T00:00:00Z",
    resolved: false,
    body: "note",
  };
}

describe("recoverForgemarkFile", () => {
  it("coalesces a splattered comment back to an attached anchor", () => {
    const body = "<!-- fmc:1 -->a<!-- /fmc:1 -->*<!-- fmc:1 -->b<!-- /fmc:1 -->* tail.";
    const file = serializeForgemarkFile({ body, comments: [rec(1, "a*b* tail")] });
    // Precondition: strict parse rejects it.
    expect(() => parseForgemarkFile(file)).toThrow();

    const { file: recovered, recovered: didRecover } = recoverForgemarkFile(file);
    expect(didRecover).toBe(true);
    expect(recovered.comments).toHaveLength(1);
    // Coalesced to one clean pair → comment 1 is attached again.
    expect(getAnchorStatus(recovered.body, recovered.comments[0]).kind).toBe("attached");
    // And the recovered file now parses strictly.
    const reparse = serializeForgemarkFile(recovered);
    expect(() => parseForgemarkFile(reparse)).not.toThrow();
  });

  it("keeps the valid comment when another is corrupt (no blanket loss)", () => {
    // Comment 1 split into two pairs by an overlap; comment 2 is clean.
    const body =
      "<!-- fmc:1 -->Outputs of modules 1, 2, <!-- /fmc:1 --><!-- fmc:9 -->and<!-- /fmc:9 -->" +
      "<!-- fmc:1 --> 7.<!-- /fmc:1 --> Also <!-- fmc:2 -->gamma<!-- /fmc:2 --> end.";
    const file = serializeForgemarkFile({
      body,
      comments: [rec(1, "Outputs of modules 1, 2, and 7."), rec(9, "and"), rec(2, "gamma")],
    });
    expect(() => parseForgemarkFile(file)).toThrow();

    const { file: recovered } = recoverForgemarkFile(file);
    // All three records survive…
    expect(recovered.comments.map((c) => c.id).sort()).toEqual([1, 2, 9]);
    // …comment 2 stays attached, comment 9 stays attached, comment 1 (split)
    // is detached for reattachment rather than dropped.
    const byId = new Map(recovered.comments.map((c) => [c.id, c]));
    expect(getAnchorStatus(recovered.body, byId.get(2)!).kind).toBe("attached");
    expect(getAnchorStatus(recovered.body, byId.get(9)!).kind).toBe("attached");
    expect(getAnchorStatus(recovered.body, byId.get(1)!).kind).toBe("orphaned");
    // The recovered file parses strictly (tolerant for the orphan).
    expect(() =>
      parseForgemarkFile(serializeForgemarkFile(recovered), { tolerant: true }),
    ).not.toThrow();
  });

  it("strips markers that have no matching record", () => {
    // fmc:7 has no YAML record; fmc:1 does. A block exists (for comment 1)
    // so strict validation runs and rejects the orphan marker.
    const body = "Hello <!-- fmc:7 -->world<!-- /fmc:7 --> and <!-- fmc:1 -->x<!-- /fmc:1 -->.";
    const file = serializeForgemarkFile({ body, comments: [rec(1, "x")] });
    expect(() => parseForgemarkFile(file)).toThrow();
    const { file: recovered, problems } = recoverForgemarkFile(file);
    // fmc:7 stripped, fmc:1 kept.
    expect(recovered.body).toContain("Hello world and <!-- fmc:1 -->x<!-- /fmc:1 -->.");
    expect(recovered.body).not.toContain("fmc:7");
    expect(problems.join(" ")).toMatch(/no matching comment/);
  });

  it("is a no-op passthrough for a clean file", () => {
    const body = "Hello <!-- fmc:1 -->world<!-- /fmc:1 --> end.";
    const file = serializeForgemarkFile({ body, comments: [rec(1, "world")] });
    const { recovered: didRecover, file: out } = recoverForgemarkFile(file);
    expect(didRecover).toBe(false);
    // Body matches what strict parse returns (incl. the block separator).
    expect(out.body).toBe(parseForgemarkFile(file).body);
    expect(out.comments).toHaveLength(1);
  });
});
