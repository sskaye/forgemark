import { describe, it, expect } from "vitest";
import { reattachOrphans } from "../../../src/format/reattachAll";
import { enclosingScope } from "../../../src/format/html/elements";
import { classifyAnchors } from "../../../src/format/reattach";
import { parseForgemarkFile } from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import type { Comment } from "../../../src/format/types";

// Re-attaching a whole review after the page was regenerated: what goes
// back without a person, what is left for one, and why.

const MARKERS = /<!--\s*\/?fmc:\d+\s*-->/g;

function comment(id: number, fields: Partial<Comment>): Comment {
  return {
    id,
    author: "Sam",
    timestamp: "2026-10-01T00:00:00Z",
    resolved: false,
    body: "Note.\n",
    ...fields,
  };
}

// A catalog that repeats a sentence in every tab, as ForgeGraph's does.
const CATALOG = `<!doctype html>
<html><body>
<section id="tab-bar"><p>Bar intro. Values are shown in thousands. Bar outro.</p></section>
<section id="tab-line"><p>Line intro. Values are shown in thousands. Line outro.</p></section>
<section id="tab-pie"><p>Same. Values are shown in thousands. Same.</p></section>
<section id="tab-area"><p>Same. Values are shown in thousands. Same.</p></section>
<figure id="fig-1"><figcaption>Figure 2. Bars</figcaption><svg></svg></figure>
<div id="tiles"></div>
</body></html>
`;

describe("reattachOrphans on a regenerated report", () => {
  it("picks the copy of a repeated sentence whose surroundings match the record", () => {
    const c = comment(1, {
      anchor_text: "Values are shown in thousands.",
      context_before: "Line intro.",
      context_after: "Line outro.",
    });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(outcomes).toEqual([
      expect.objectContaining({ id: 1, outcome: "attached", how: "context", line: 4 }),
    ]);
    expect(file.body).toContain(
      "Line intro. <!-- fmc:1 -->Values are shown in thousands.<!-- /fmc:1 --> Line outro.",
    );
    expect(file.body.replace(MARKERS, "")).toBe(CATALOG);
  });

  it("leaves a repeated sentence orphaned when the surroundings tie", () => {
    const c = comment(1, {
      anchor_text: "Values are shown in thousands.",
      context_before: "Same.",
      context_after: "Same.",
    });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "ambiguous" });
    expect(outcomes[0].outcome === "orphaned" && outcomes[0].detail).toMatch(/appears 4 times/);
    expect(file.body).toBe(CATALOG);
  });

  it("leaves a repeated sentence orphaned when nothing was recorded around it", () => {
    const c = comment(1, { anchor_text: "Values are shown in thousands." });
    const { outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "ambiguous" });
  });

  it("finds a figure by its id and refreshes the caption it records", () => {
    const c = comment(1, {
      anchor_text: "Figure 1. Bars",
      anchor_kind: "element",
      anchor_selector: "#fig-1",
      context_before: "stale",
    });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "selector" });
    expect(file.body).toContain('<!-- fmc:1 --><figure id="fig-1">');
    const record = file.comments[0];
    expect(record.anchor_text).toBe("Figure 2. Bars");
    expect(record.anchor_kind).toBe("element");
    expect(record.anchor_selector).toBe("#fig-1");
    expect(record.context_before).not.toBe("stale");
  });

  it("keeps a passage comment a passage, with its own text, and nests two on one element", () => {
    const tiles = (id: number, text: string) =>
      comment(id, {
        anchor_text: text,
        anchor_kind: "passage",
        anchor_selector: "#tiles",
        context_before: "Glucose tab",
        context_after: "Average 6.1",
      });
    const { file, outcomes } = reattachOrphans(
      { body: CATALOG, comments: [tiles(1, "Time in range 72%"), tiles(2, "Average 6.1")] },
      "html",
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(["attached", "attached"]);
    for (const [i, text] of ["Time in range 72%", "Average 6.1"].entries()) {
      expect(file.comments[i]).toMatchObject({
        anchor_text: text,
        anchor_kind: "passage",
        anchor_selector: "#tiles",
        context_before: "Glucose tab",
      });
    }
    expect(file.body.replace(MARKERS, "")).toBe(CATALOG);
    const statuses = classifyAnchors(file.body, file.comments, "html");
    expect(statuses.get(1)?.kind).toBe("attached");
    expect(statuses.get(2)?.kind).toBe("attached");
  });

  it("says why when the element or the text is gone", () => {
    const { outcomes } = reattachOrphans(
      {
        body: CATALOG,
        comments: [
          comment(1, { anchor_text: "Old", anchor_kind: "element", anchor_selector: "#gone" }),
          comment(2, { anchor_text: "Old caption", anchor_kind: "element" }),
          comment(3, { anchor_text: "A claim that was cut entirely." }),
        ],
      },
      "html",
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        id: 1,
        reason: "no-element",
        detail: "No element #gone in the page.",
      }),
      expect.objectContaining({ id: 2, reason: "no-element" }),
      expect.objectContaining({ id: 3, reason: "not-found" }),
    ]);
  });

  it("names the closest near match for a reworded passage, and does not attach it", () => {
    const c = comment(1, { anchor_text: "Values are shown in thousands of units." });
    const body = CATALOG.replace(
      "Bar intro. Values are shown in thousands.",
      "Bar intro. Values are shown in thousands of unit.",
    );
    const { file, outcomes } = reattachOrphans({ body, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "not-found" });
    expect(outcomes[0].outcome === "orphaned" && outcomes[0].detail).toMatch(
      /Closest: .*% similar/,
    );
    expect(file.body).toBe(body);
  });

  it("refuses the second of two comments whose passages overlap", () => {
    const { file, outcomes } = reattachOrphans(
      {
        body: CATALOG,
        comments: [
          comment(1, { anchor_text: "Bar intro. Values" }),
          comment(2, { anchor_text: "Values are shown in thousands. Bar outro." }),
        ],
      },
      "html",
    );
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "text" });
    expect(outcomes[1]).toMatchObject({ outcome: "orphaned", reason: "overlap" });
    expect(outcomes[1].outcome === "orphaned" && outcomes[1].detail).toMatch(/comment 1/);
    expect(file.comments[1]).toEqual(
      comment(2, { anchor_text: "Values are shown in thousands. Bar outro." }),
    );
  });

  it("leaves floating notes and attached comments alone", () => {
    const body = CATALOG.replace("Bar intro.", "<!-- fmc:1 -->Bar intro.<!-- /fmc:1 -->");
    const attached = comment(1, { anchor_text: "Bar intro." });
    const note = comment(2, { floating: true });
    const result = reattachOrphans({ body, comments: [attached, note] }, "html");
    expect(result.outcomes).toEqual([]);
    expect(result.file.body).toBe(body);
    expect(result.file.comments).toEqual([attached, note]);
  });

  it("produces a file that serializes and parses back", () => {
    const comments = [
      comment(1, {
        anchor_text: "Values are shown in thousands.",
        context_before: "Line intro.",
        context_after: "Line outro.",
      }),
      comment(2, {
        anchor_text: "Figure 1. Bars",
        anchor_kind: "element",
        anchor_selector: "#fig-1",
      }),
    ];
    const { file } = reattachOrphans({ body: CATALOG, comments }, "html");
    const text = serializeForgemarkFile(file);
    const parsed = parseForgemarkFile(text, { format: "html" });
    expect(parsed.comments.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("anchor_scope", () => {
  it("names the innermost enclosing element with an id", () => {
    const at = CATALOG.indexOf("Line intro.");
    expect(enclosingScope(CATALOG, at, at + 5)).toBe("#tab-line");
    expect(enclosingScope("<p>No ids here.</p>", 3, 6)).toBeUndefined();
    const nested = '<section id="outer"><div id="1bad"><p id="inner">Text</p></div></section>';
    const t = nested.indexOf("Text");
    expect(enclosingScope(nested, t, t + 4)).toBe("#inner");
    // An id that isn't a valid selector is passed over for the next one out.
    const bad = '<section id="outer"><div id="1bad">Text</div></section>';
    expect(enclosingScope(bad, bad.indexOf("Text"), bad.indexOf("Text") + 4)).toBe("#outer");
  });

  it("tells repeated copies apart by the element they sit in", () => {
    // The two "Same." tabs have identical surroundings; only the id differs.
    const c = comment(1, {
      anchor_text: "Values are shown in thousands.",
      anchor_scope: "#tab-area",
      context_before: "Same.",
      context_after: "Same.",
    });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "scope", line: 6 });
    expect(file.body).toContain(
      '<section id="tab-area"><p>Same. <!-- fmc:1 -->Values are shown in thousands.<!-- /fmc:1 -->',
    );
    expect(file.comments[0].anchor_scope).toBe("#tab-area");
  });

  it("falls back to the whole page when the element is gone or no longer holds the text", () => {
    const moved = comment(1, {
      anchor_text: "Bar intro.",
      anchor_scope: "#tab-line", // the sentence now lives in another tab
    });
    const gone = comment(2, {
      anchor_text: "Values are shown in thousands.",
      anchor_scope: "#tab-gone",
      context_before: "Same.",
      context_after: "Same.",
    });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [moved, gone] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "text" });
    // Re-recorded where it was actually found.
    expect(file.comments[0].anchor_scope).toBe("#tab-bar");
    expect(outcomes[1]).toMatchObject({ outcome: "orphaned", reason: "ambiguous" });
  });

  it("is recorded on a passage re-attached by its text, and dropped where there is none", () => {
    const c = comment(1, { anchor_text: "Bar intro.", anchor_scope: "#stale" });
    const { file } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    expect(file.comments[0].anchor_scope).toBe("#tab-bar");
    const plain = "<html><body><p>Bar intro.</p></body></html>";
    const again = reattachOrphans({ body: plain, comments: [c] }, "html");
    expect(again.file.comments[0].anchor_scope).toBeUndefined();
  });

  it("round-trips through the file", () => {
    const c = comment(1, { anchor_text: "Bar intro.", anchor_scope: "#tab-bar" });
    const { file } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    const parsed = parseForgemarkFile(serializeForgemarkFile(file), { format: "html" });
    expect(parsed.comments[0].anchor_scope).toBe("#tab-bar");
    expect(parsed.comments[0].additionalKeys).toBeUndefined();
  });
});

describe("reattachOrphans on Markdown", () => {
  const DOC = `# Results

The rate doubled. We report the median here.

## Appendix

The rate doubled. Treat this with care.
`;

  it("chooses a repeated sentence by its surroundings", () => {
    const c = comment(1, {
      anchor_text: "The rate doubled.",
      context_before: "Appendix",
      context_after: "Treat this with care.",
    });
    const { file, outcomes } = reattachOrphans({ body: DOC, comments: [c] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "context", line: 7 });
    expect(file.body).toContain("<!-- fmc:1 -->The rate doubled.<!-- /fmc:1 --> Treat this");
  });

  it("attaches a passage found once, refreshing its context", () => {
    const c = comment(1, { anchor_text: "We report the median here.", context_after: "old" });
    const { file, outcomes } = reattachOrphans({ body: DOC, comments: [c] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "text", line: 3 });
    expect(file.comments[0].context_before).toMatch(/The rate doubled\.$/);
    expect(file.comments[0].context_after).not.toBe("old");
  });
});
