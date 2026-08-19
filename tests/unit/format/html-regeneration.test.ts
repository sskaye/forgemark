// Surviving a regenerated report.
//
// Markdown documents are edited in place. Generated HTML reports are
// *replaced* — the agent reruns and writes a whole new file, so every
// marker is gone while the prose largely survives. This is the dominant
// HTML workflow, and if a review can't survive it the feature is a demo.

import { describe, it, expect } from "vitest";
import { findCandidates } from "../../../src/format/reattach";
import { findBySelector, findByText } from "../../../src/format/html/elements";
import { insertMarkersIntoBody } from "../../../src/format/compose";
import { parseForgemarkFile } from "../../../src/format/parser";
import { classifyAnchors } from "../../../src/format/reattach";
import type { Comment } from "../../../src/format/types";

// The report as it was reviewed.
const V1 = `<!doctype html>
<html><head><title>Meals</title></head>
<body>
<h2>B3 — the estimator</h2>
<p>Eliminating the linear block analytically is <b>variable projection</b>.</p>
<figure id="fig-3"><figcaption>Figure 3. Protein sensitivity is hard to pin</figcaption><svg viewBox="0 0 10 10"></svg></figure>
<p>The outer loop is a grid, then a golden-section polish.</p>
</body></html>
`;

// The same report after the agent reran: a new section above, the
// wording tightened, the figure renumbered — and every marker gone.
const V2 = `<!doctype html>
<html><head><title>Meals</title></head>
<body>
<h2>B2 — the simulator's protein term</h2>
<p>Protein is entered at half its weight.</p>
<h2>B3 — the estimator</h2>
<p>Eliminating the linear block analytically is <b>variable projection</b>.</p>
<figure id="fig-3"><figcaption>Figure 4. Protein sensitivity is hard to pin</figcaption><svg viewBox="0 0 10 10"></svg></figure>
<p>The outer loop is a grid, then a golden-section polish from the grid minimum.</p>
</body></html>
`;

const textComment: Comment = {
  id: 1,
  anchor_text: "variable projection",
  context_before: "Eliminating the linear block analytically is",
  context_after: ".",
  author: "Claude",
  timestamp: "2026-08-16T09:00:00Z",
  resolved: false,
  body: "Gloss this.",
};

const figureComment: Comment = {
  id: 2,
  anchor_text: "Figure 3. Protein sensitivity is hard to pin",
  anchor_kind: "element",
  anchor_selector: "#fig-3",
  author: "Sam",
  timestamp: "2026-08-16T09:05:00Z",
  resolved: false,
  body: "Axis label is cut off.",
};

describe("element location", () => {
  it("resolves a recorded id to the whole element, end tag included", () => {
    const span = findBySelector(V2, "#fig-3")!;
    expect(span.text.startsWith('<figure id="fig-3">')).toBe(true);
    expect(span.text.endsWith("</figure>")).toBe(true);
  });

  it("finds the smallest element containing the text, not the whole body", () => {
    const span = findByText(V1, "Figure 3. Protein sensitivity is hard to pin")!;
    expect(span.text.startsWith("<figcaption>")).toBe(true);
  });

  it("refuses selectors it did not write", () => {
    expect(findBySelector(V2, ".chart > svg:first-child")).toBeNull();
    expect(findBySelector(V2, "figure")).toBeNull();
  });

  it("returns null for an id the report no longer has", () => {
    expect(findBySelector(V2, "#fig-99")).toBeNull();
  });
});

describe("reattaching into a regenerated report", () => {
  it("recovers a prose anchor whose surroundings moved", () => {
    const [best] = findCandidates(V2, textComment, "html");
    expect(best).toBeDefined();
    expect(V2.slice(best.from, best.to)).toBe("variable projection");
    expect(best.score).toBeGreaterThanOrEqual(0.95);
  });

  it("recovers a figure by its id even after the caption is renumbered", () => {
    // The caption changed from "Figure 3." to "Figure 4.", so text
    // matching alone would be a guess. The id makes it exact.
    const [best] = findCandidates(V2, figureComment, "html");
    expect(best.score).toBe(1);
    expect(V2.slice(best.from, best.to)).toContain('<figure id="fig-3">');
    expect(V2.slice(best.from, best.to)).toContain("</figure>");
  });

  it("still finds the figure when the id is gone, via its caption", () => {
    // The agent kept the caption but dropped the id. Text is all that's
    // left to go on, and it must still resolve to the whole figure —
    // reattaching to the caption line alone would leave the chart
    // uncommented while looking like a success.
    const withoutId = V2.replace(' id="fig-3"', "").replace("Figure 4.", "Figure 3.");
    const noSelector: Comment = { ...figureComment, anchor_selector: undefined };
    const [best] = findCandidates(withoutId, noSelector, "html");
    expect(best).toBeDefined();
    expect(withoutId.slice(best.from, best.to).startsWith("<figure>")).toBe(true);
    expect(withoutId.slice(best.from, best.to).endsWith("</figure>")).toBe(true);
  });

  it("produces a file that reattaches cleanly and parses", () => {
    const candidates = [
      { c: figureComment, best: findCandidates(V2, figureComment, "html")[0] },
      { c: textComment, best: findCandidates(V2, textComment, "html")[0] },
    ].sort((a, b) => b.best.from - a.best.from);

    let body = V2;
    for (const { c, best } of candidates) {
      body = insertMarkersIntoBody(body, best.from, best.to, c.id);
    }
    const parsed = parseForgemarkFile(body, { format: "html", tolerant: true });
    const statuses = classifyAnchors(parsed.body, [textComment, figureComment], "html");
    expect(statuses.get(1)?.kind).toBe("attached");
    expect(statuses.get(2)?.kind).toBe("attached");
    // Only four markers were added; the report is otherwise untouched.
    expect(body.replace(/<!--\s*\/?fmc:\d+\s*-->/g, "")).toBe(V2);
  });

  it("reports no candidates when the passage really is gone", () => {
    const deleted: Comment = { ...textComment, anchor_text: "a claim that was cut entirely" };
    expect(findCandidates(V2, deleted, "html")).toEqual([]);
  });

  it("ranks an ambiguous passage as several candidates, not one", () => {
    // Two identical sentences: the reviewer has to choose, and the bulk
    // reattach must not decide for them.
    const twice = V2.replace(
      "<p>Protein is entered at half its weight.</p>",
      "<p>Protein is entered at half its weight.</p><p>Protein is entered at half its weight.</p>",
    );
    const ambiguous: Comment = {
      ...textComment,
      anchor_text: "Protein is entered at half its weight.",
      context_before: "",
      context_after: "",
    };
    const candidates = findCandidates(twice, ambiguous, "html");
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[1].score).toBeGreaterThanOrEqual(0.95);
  });
});
