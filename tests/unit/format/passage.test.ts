import { describe, it, expect } from "vitest";
import { locatePassage, applyPlacement, AnchorError } from "../../../src/format/locate";
import { parseForgemarkFile } from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import type { Comment } from "../../../src/format/types";

// A passage a report's script produces at load has no place in the
// source. Its comment anchors the element that will hold it and keeps
// the passage as anchor_text.

const REPORT = `<html><body>
<h1>Dashboard</h1>
<div id="tiles"></div>
<section id="agp"><h2>Glucose</h2></section>
</body></html>
`;

describe("locatePassage", () => {
  it("wraps the element named by the selector and records the passage", () => {
    const placement = locatePassage(REPORT, "#tiles", "Time in range  72%", "html", {
      before: "Glucose tab",
      after: "Average 6.1",
    });
    expect(placement.anchor_kind).toBe("passage");
    expect(placement.anchor_selector).toBe("#tiles");
    expect(placement.anchor_text).toBe("Time in range 72%");
    expect(placement.context_before).toBe("Glucose tab");
    expect(placement.context_after).toBe("Average 6.1");
    const body = applyPlacement(REPORT, placement, 4);
    expect(body).toContain('<!-- fmc:4 --><div id="tiles"></div><!-- /fmc:4 -->');
  });

  it("refuses an element the source does not have, and an empty passage", () => {
    expect(() => locatePassage(REPORT, "#nope", "x", "html")).toThrow(AnchorError);
    expect(() => locatePassage(REPORT, "#tiles", "  ", "html")).toThrow(AnchorError);
  });
});

describe("a passage record", () => {
  it("round-trips through the file", () => {
    const record: Comment = {
      id: 4,
      anchor_text: "Time in range 72%",
      anchor_kind: "passage",
      anchor_selector: "#tiles",
      context_before: "Glucose tab",
      context_after: "Average 6.1",
      author: "Reviewer",
      timestamp: "2026-09-04T10:00:00Z",
      resolved: false,
      body: "Is this the 14-day window?\n",
    };
    const placement = locatePassage(REPORT, "#tiles", record.anchor_text!, "html");
    const file = serializeForgemarkFile({
      body: applyPlacement(REPORT, placement, 4),
      comments: [record],
    });
    expect(file).toContain("anchor_kind: passage");
    const parsed = parseForgemarkFile(file);
    expect(parsed.comments[0].anchor_kind).toBe("passage");
    expect(parsed.comments[0].anchor_text).toBe("Time in range 72%");
    expect(serializeForgemarkFile(parsed)).toBe(file);
  });

  it("is refused with any other kind", () => {
    const file = `<p>x</p>\n\n<!-- forgemark-comments\n- id: 1\n  anchor_text: x\n  anchor_kind: blob\n  author: A\n  timestamp: 2026-01-01T00:00:00Z\n  resolved: false\n  body: |\n    hi\n-->\n`;
    expect(() => parseForgemarkFile(file)).toThrow(/anchor_kind/);
  });
});

describe("several passages on one element", () => {
  it("nest their pairs around the element and lint clean", async () => {
    const one = locatePassage(REPORT, "#agp", "Glucose for the month", "html");
    const withOne = applyPlacement(REPORT, one, 3);
    const two = locatePassage(withOne, "#agp", "Sleep for the month", "html");
    const withTwo = applyPlacement(withOne, two, 6);
    expect(withTwo).toContain(
      '<!-- fmc:3 --><!-- fmc:6 --><section id="agp"><h2>Glucose</h2></section><!-- /fmc:6 --><!-- /fmc:3 -->',
    );
    const records: Comment[] = [3, 6].map((id) => ({
      id,
      anchor_text: id === 3 ? "Glucose for the month" : "Sleep for the month",
      anchor_kind: "passage",
      anchor_selector: "#agp",
      author: "R",
      timestamp: "2026-09-04T10:00:00Z",
      resolved: false,
      body: "x\n",
    }));
    const file = serializeForgemarkFile({ body: withTwo, comments: records });
    expect(parseForgemarkFile(file).comments.map((c) => c.id)).toEqual([3, 6]);
    const { lintText } = await import("../../../cli/lint");
    const report = lintText(file, "html");
    expect(report.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("still refuses a passage that overlaps a different element's anchor", () => {
    const outer = locatePassage(REPORT, "#agp", "x", "html");
    const body = applyPlacement(REPORT, outer, 3);
    // #tiles is a sibling, fine; a selector inside #agp is not.
    expect(() => locatePassage(body, "#agp h2", "Glucose", "html")).toThrow(AnchorError);
    expect(() => locatePassage(body, "#tiles", "y", "html")).not.toThrow();
  });
});
