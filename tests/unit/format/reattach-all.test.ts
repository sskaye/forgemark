import { describe, it, expect } from "vitest";
import { reattachOrphans } from "../../../src/format/reattachAll";
import { enclosingScope } from "../../../src/format/html/elements";
import { locateAnchor, scopeOfPlacement } from "../../../src/format/locate";
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
    // No surroundings recorded on either: by text alone, and said so.
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "unchecked" });
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

  it("keeps a comment orphaned when its element is still there without the text", () => {
    // The sentence's tab is still on the page; it no longer holds it.
    // The copy in another tab is another passage.
    const moved = comment(1, { anchor_text: "Bar intro.", anchor_scope: "#tab-line" });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [moved] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "not-in-scope" });
    expect(outcomes[0].outcome === "orphaned" && outcomes[0].detail).toMatch(
      /no longer in #tab-line, though it appears once elsewhere, at line 3/,
    );
    // The record is left as it was.
    expect(file.comments[0]).toEqual(moved);
  });

  it("falls back to the whole page only when the element is gone", () => {
    const gone = comment(2, {
      anchor_text: "Values are shown in thousands.",
      anchor_scope: "#tab-gone",
      context_before: "Same.",
      context_after: "Same.",
    });
    const { outcomes } = reattachOrphans({ body: CATALOG, comments: [gone] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "ambiguous" });
  });

  it("is recorded on a passage re-attached by its text, and dropped where there is none", () => {
    const c = comment(1, { anchor_text: "Bar intro.", anchor_scope: "#stale" });
    const { file, outcomes } = reattachOrphans({ body: CATALOG, comments: [c] }, "html");
    // No surroundings recorded: attached by its text alone, and said so.
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "unchecked" });
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
    // The words before still agree; the stale words after are replaced.
    const c = comment(1, {
      anchor_text: "We report the median here.",
      context_before: "The rate doubled.",
      context_after: "old",
    });
    const { file, outcomes } = reattachOrphans({ body: DOC, comments: [c] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "text", line: 3 });
    expect(file.comments[0].context_before).toMatch(/The rate doubled\.$/);
    expect(file.comments[0].context_after).not.toBe("old");
  });
});

// ForgeGraph's report against 1.10.1: a comment asking for its own value
// to change, after the change, found the old value on another row and
// moved there, reporting success and overwriting what it had recorded.
describe("a passage whose text turns up somewhere else", () => {
  const page = (rows: string) =>
    `<!doctype html><html><body>\n<table>\n${rows}</table>\n</body></html>\n`;
  const row = (id: string | null, label: string, value: string) =>
    `<tr${id ? ` id="${id}"` : ""}><td>${label}</td><td>${value}</td></tr>\n`;

  // The comment as `comment --anchor "0.06"` records it on the second row.
  function made(ids: boolean): Comment {
    const original = page(
      row(ids ? "r1" : null, "frame width", "0.15") + row(ids ? "r2" : null, "edge width", "0.06"),
    );
    const p = locateAnchor(original, "0.06", "html");
    const scope = scopeOfPlacement(original, p, "html");
    return comment(1, {
      anchor_text: "0.06",
      ...(p.context_before ? { context_before: p.context_before } : {}),
      ...(p.context_after ? { context_after: p.context_after } : {}),
      ...(scope ? { anchor_scope: scope } : {}),
    });
  }

  for (const ids of [true, false]) {
    const I = (id: string) => (ids ? id : null);
    const label = ids ? "with row ids" : "without ids";

    it(`stays orphaned when the value moved to another row, ${label}`, () => {
      const c = made(ids);
      expect(c.context_before).toMatch(/edge width$/);
      const rebuilt = page(
        row(I("r1"), "frame width", "0.06") + row(I("r2"), "edge width", "0.05"),
      );
      const { file, outcomes } = reattachOrphans({ body: rebuilt, comments: [c] }, "html");
      expect(outcomes[0]).toMatchObject({
        outcome: "orphaned",
        reason: ids ? "not-in-scope" : "surroundings-differ",
      });
      expect(outcomes[0].outcome === "orphaned" && outcomes[0].detail).toMatch(/line 3/);
      expect(file.body).toBe(rebuilt);
      expect(file.comments[0]).toEqual(c);
    });

    it(`still re-attaches when a row is inserted above it, ${label}`, () => {
      const rebuilt = page(
        row(I("r1"), "frame width", "0.15") +
          row(I("r9"), "corner radius", "0.3") +
          row(I("r2"), "edge width", "0.06"),
      );
      const { file, outcomes } = reattachOrphans({ body: rebuilt, comments: [made(ids)] }, "html");
      expect(outcomes[0]).toMatchObject({
        outcome: "attached",
        how: ids ? "scope" : "text",
        line: 5,
      });
      expect(file.body).toContain("<td>edge width</td><td><!-- fmc:1 -->0.06<!-- /fmc:1 -->");
    });
  }

  it("follows the row's id when only its label changed", () => {
    const rebuilt = page(row("r1", "frame width", "0.15") + row("r2", "outline width", "0.06"));
    const { outcomes } = reattachOrphans({ body: rebuilt, comments: [made(true)] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "scope" });
  });

  it("attaches prose when one side of the passage was edited", () => {
    const before = "<p>We set the margin to 0.06 for every chart in the set.</p>";
    const p = locateAnchor(before, "0.06", "html");
    const c = comment(1, {
      anchor_text: "0.06",
      context_before: p.context_before,
      context_after: p.context_after,
    });
    const after = "<p>We now set the gap to 0.06 for every chart in the set.</p>";
    const { outcomes } = reattachOrphans({ body: after, comments: [c] }, "html");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "text" });
  });

  it("refuses the closest of several copies when its surroundings still differ", () => {
    const body = "<p>Gamma width 0.06 here.</p><p>Delta width 0.06 there.</p>";
    const c = comment(1, {
      anchor_text: "0.06",
      context_before: "Beta width",
      context_after: "here.",
    });
    // "here." agrees with the first copy's after side: taken.
    expect(reattachOrphans({ body, comments: [c] }, "html").outcomes[0]).toMatchObject({
      outcome: "attached",
      how: "context",
    });
    // Nothing on either side agrees with any copy: refused.
    const stranger = comment(1, {
      anchor_text: "0.06",
      context_before: "Beta width",
      context_after: "elsewhere.",
    });
    const { outcomes } = reattachOrphans({ body, comments: [stranger] }, "html");
    expect(outcomes[0].outcome).toBe("orphaned");
  });
});

// ForgeGraph's report against 1.11.0: in a table, the cell next to a
// passage is often the same on many rows, so "the words next to it
// match" picked whichever row shared that cell. The surroundings must
// match across the passage's own row.
describe("a passage repeated down a table", () => {
  const header =
    "| param | default | range | status | description |\n| --- | --- | --- | --- | --- |\n";
  // ForgeGraph's table, as reported.
  const row = (name: string, value: string, range: string, status: string, desc: string) =>
    `| ${name} | ${value} | ${range} | ${status} | ${desc} |\n`;
  const shape = row(
    "series.marker.shape",
    "circle",
    "circle, square",
    "fixed",
    "Marker shapes for groups, in order.",
  );
  const size = (status: string) =>
    row("series.marker.size", "0.5", "float > 0", status, "Marker size, × base size.");
  const edge = row(
    "series.marker.edge_width",
    "0.05",
    "float > 0",
    "fixed",
    "Marker outline width, × base size.",
  );
  const fill = row(
    "series.marker.fill",
    "filled",
    "filled, open",
    "fixed",
    "Marker fills for groups, in order.",
  );

  // As `comment --anchor "fixed" --occurrence 2` records it.
  function made(): Comment {
    const original = header + shape + size("fixed") + edge + fill;
    const p = locateAnchor(original, "fixed", "markdown", { occurrence: 2 });
    expect(p.context_before).toBe("series.marker.size 0.5 float > 0");
    return comment(1, {
      anchor_text: "fixed",
      context_before: p.context_before,
      context_after: p.context_after,
    });
  }

  it("stays orphaned when its row's text changed and other rows still have it", () => {
    const rebuilt = header + shape + edge + fill + size("variable");
    const { file, outcomes } = reattachOrphans({ body: rebuilt, comments: [made()] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "surroundings-differ" });
    expect(file.body).toBe(rebuilt);
  });

  it("follows its row when the row moves unchanged", () => {
    const rebuilt = header + shape + edge + fill + size("fixed");
    const { file, outcomes } = reattachOrphans({ body: rebuilt, comments: [made()] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", how: "context", line: 6 });
    expect(file.body).toContain("| series.marker.size | 0.5 | float > 0 | <!-- fmc:1 -->fixed");
  });

  it("does the same in an HTML table without row ids", () => {
    const tr = (name: string, value: string, status: string) =>
      `<tr><td>${name}</td><td>${value}</td><td>float &gt; 0</td><td>${status}</td></tr>\n`;
    const table = (rows: string) =>
      `<!doctype html><html><body>\n<table>\n${rows}</table>\n</body></html>\n`;
    const original = table(tr("size", "0.5", "fixed") + tr("edge", "0.05", "fixed"));
    const p = locateAnchor(original, "fixed", "html", { occurrence: 1 });
    const c = comment(1, {
      anchor_text: "fixed",
      context_before: p.context_before,
      context_after: p.context_after,
    });
    const changed = table(tr("edge", "0.05", "fixed") + tr("size", "0.5", "variable"));
    expect(reattachOrphans({ body: changed, comments: [c] }, "html").outcomes[0]).toMatchObject({
      outcome: "orphaned",
    });
    const moved = table(tr("edge", "0.05", "fixed") + tr("size", "0.5", "fixed"));
    expect(reattachOrphans({ body: moved, comments: [c] }, "html").outcomes[0]).toMatchObject({
      outcome: "attached",
      line: 4,
    });
  });
});

// ForgeGraph's report against 1.12.0: a recording cut at 80 characters
// ends in a piece of a word ("ers" of "parameters"), which the whole-row
// comparison then found different, and the message quoted the words next
// to the passage, which agreed, rather than where they parted.
describe("surroundings cut mid-word", () => {
  // ForgeGraph's spec mirror, as it was.
  const spec =
    "parameters:          *# The layer's parameters, which a GraphSpec's layers entry sets after its type.*\\\n" +
    "    axis: y          *# \\[x, y\\]; Axis the bars extend along.*\\\n" +
    "    value:\\\n" +
    "        lower: None          *# \\[float, column\\]; Distance below each value: a number or a column. A GraphSpec must set it.*\n";
  // Comment 5 there, recorded by 1.12.0.
  const five = comment(5, {
    anchor_text: "Axis the bars extend along.",
    context_before:
      "ers, which a GraphSpec's layers entry sets after its type.*\\ axis: y # \\[x, y\\];",
    context_after:
      "\\ value:\\ lower: None # \\[float, column\\]; Distance below each value: a number o",
  });

  it("re-attaches a comment whose recording ends in a piece of a word", () => {
    const { outcomes } = reattachOrphans({ body: spec, comments: [five] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "attached", line: 2 });
  });

  it("records whole words", () => {
    const p = locateAnchor(spec, "Axis the bars extend along.", "markdown");
    expect(p.context_before.startsWith("ers")).toBe(false);
    expect(p.context_before).toMatch(/^\S+ /);
    expect(spec.replace(/\s+/g, " ")).toContain(p.context_before.split(" ")[0]);
    expect(p.context_after).not.toMatch(/ o$/);
  });

  it("quotes each side where it parts from the recording", () => {
    const changed = spec
      .replace("which a GraphSpec's layers", "which a layer's")
      .replace("Distance below each value", "Distance under each value");
    const { outcomes } = reattachOrphans({ body: changed, comments: [five] }, "markdown");
    expect(outcomes[0]).toMatchObject({ outcome: "orphaned", reason: "surroundings-differ" });
    const detail = outcomes[0].outcome === "orphaned" ? outcomes[0].detail : "";
    expect(detail).toContain(
      `before it "…layers entry sets after…", there "…layer's entry sets after…"`,
    );
    expect(detail).toContain(
      `after it "…\\[float, column\\]; Distance below…", there "…\\[float, column\\]; Distance under…"`,
    );
  });

  it("quotes only a side that differs", () => {
    // Nothing recorded before it: only the after side tells, and only it
    // is quoted, not the words before the passage.
    const changed = spec.replace("Distance below each value", "Distance under each value");
    const c = comment(5, { ...five, context_before: undefined });
    const o = reattachOrphans({ body: changed, comments: [c] }, "markdown").outcomes[0];
    const detail = o.outcome === "orphaned" ? o.detail : "";
    expect(detail).not.toContain("before it");
    expect(detail).toMatch(/: after it ".*Distance below…", there ".*Distance under…"\.$/);
  });
});
