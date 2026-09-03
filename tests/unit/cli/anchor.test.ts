import { describe, it, expect } from "vitest";
import { locateAnchor, locateElement, applyPlacement, AnchorError } from "../../../cli/anchor";
import { parseForgemarkFile } from "../../../src/format";

const MD = `# Title

The kickoff finding seems strong: teams who scheduled a kickoff <!-- fmc:1 -->retained at twice the rate<!-- /fmc:1 -->, even after
controlling for **company size**. Rate matters. The rate matters twice.

Use \`npm test\` to run it.

\`\`\`python
print("hi")
\`\`\`

Run:

\`\`\`
echo hi
\`\`\`

Done.
`;

describe("locateAnchor (Markdown)", () => {
  it("finds a phrase across a line break and inline formatting", () => {
    const p = locateAnchor(MD, "even after controlling for company size", "markdown");
    expect(MD.slice(p.start, p.end)).toBe("even after\ncontrolling for **company size**");
    expect(p.anchor_text).toBe("even after controlling for company size");
    expect(p.block).toBe(false);
  });

  it("records context either side, as rendered text", () => {
    const p = locateAnchor(MD, "Rate matters", "markdown");
    expect(p.context_before).toMatch(/company size\.$/);
    expect(p.context_after).toMatch(/The rate matters twice\./);
  });

  it("refuses an ambiguous phrase and lists the occurrences", () => {
    expect(() => locateAnchor(MD, "matters", "markdown")).toThrow(/appears 2 times/);
    expect(() => locateAnchor(MD, "matters", "markdown")).toThrow(/--occurrence/);
  });

  it("takes --occurrence to disambiguate", () => {
    const p = locateAnchor(MD, "matters", "markdown", { occurrence: 2 });
    expect(MD.slice(p.start, p.end)).toBe("matters");
    expect(MD.slice(p.start - 5, p.start)).toBe("rate ");
    expect(() => locateAnchor(MD, "matters", "markdown", { occurrence: 3 })).toThrow(
      /out of range/,
    );
  });

  it("prefers an exact-case match, and falls back to case-insensitive", () => {
    const exact = locateAnchor(MD, "rate matters", "markdown");
    expect(MD.slice(exact.start - 4, exact.start)).toBe("The ");
    const folded = locateAnchor(MD, "RATE MATTERS TWICE", "markdown");
    expect(MD.slice(folded.start, folded.end)).toBe("rate matters twice");
  });

  it("matches whole words only", () => {
    expect(() => locateAnchor(MD, "ate matters", "markdown")).toThrow(AnchorError);
  });

  it("refuses a span that overlaps an existing anchor", () => {
    expect(() => locateAnchor(MD, "twice the rate", "markdown")).toThrow(
      /overlaps the anchor of comment 1/,
    );
    expect(() => locateAnchor(MD, "kickoff retained", "markdown")).toThrow(/comment 1/);
  });

  it("widens a match inside inline code to the whole code span", () => {
    const p = locateAnchor(MD, "npm test", "markdown");
    expect(MD.slice(p.start, p.end)).toBe("`npm test`");
    expect(p.anchor_text).toBe("npm test");
  });

  it("snaps a match inside a fence to the whole block, markers on their own lines", () => {
    const p = locateAnchor(MD, 'print("hi")', "markdown");
    expect(p.block).toBe(true);
    expect(MD.slice(p.start, p.end)).toBe('```python\nprint("hi")\n```');
    expect(p.anchor_text).toBe('print("hi")');
    const body = applyPlacement(MD, p, 2);
    expect(body).toContain('<!-- fmc:2 -->\n```python\nprint("hi")\n```\n<!-- /fmc:2 -->\n');
  });

  it("refuses a span that straddles a fence boundary", () => {
    expect(() => locateAnchor(MD, "Run: echo hi", "markdown")).toThrow(/straddles/);
  });

  it("reports a phrase that is not there", () => {
    expect(() => locateAnchor(MD, "no such words", "markdown")).toThrow(/was not found/);
  });

  it("produces a body the parser accepts", () => {
    const p = locateAnchor(MD, "Done", "markdown");
    const body = applyPlacement(MD, p, 2);
    expect(body).toContain("<!-- fmc:2 -->Done<!-- /fmc:2 -->");
    expect(() =>
      parseForgemarkFile(
        body +
          "\n<!-- forgemark-comments\n- id: 1\n  anchor_text: x\n  author: A\n  timestamp: 2026-01-01T00:00:00Z\n  resolved: false\n  body: b\n- id: 2\n  anchor_text: Done\n  author: A\n  timestamp: 2026-01-01T00:00:00Z\n  resolved: false\n  body: b\n-->\n",
      ),
    ).not.toThrow();
  });
});

const HTML = `<!doctype html>
<html><head><title>R</title><style>p { color: red }</style></head>
<body>
<p class="verdict">The programmed basal is too high over
the evening and the small hours.</p>
<p>Minimising over the rest is <b>variable projection</b>, see <code>ISF</code> &amp; friends.</p>
<figure id="fig-3"><figcaption>Figure 3. Recovery</figcaption><svg></svg></figure>
<table id="tbl-1"><tr><th>Day</th><th>Dose</th></tr><tr><td>1</td><td>2</td></tr></table>
<script>var s = "the evening and the small hours";</script>
</body></html>
`;

describe("locateAnchor (HTML)", () => {
  it("finds a phrase in rendered text, ignoring the same words inside a script", () => {
    const p = locateAnchor(HTML, "the evening and the small hours", "html");
    expect(p.start).toBeLessThan(HTML.indexOf("<script>"));
    expect(HTML.slice(p.start, p.end)).toBe("the evening and the small hours");
    expect(p.anchor_text).toBe("the evening and the small hours");
  });

  it("finds a phrase across a hard-wrapped line", () => {
    const p = locateAnchor(HTML, "too high over the evening", "html");
    expect(HTML.slice(p.start, p.end)).toBe("too high over\nthe evening");
    expect(p.anchor_text).toBe("too high over the evening");
  });

  it("maps a phrase that crosses tags and entities back to exact source", () => {
    const p = locateAnchor(HTML, "variable projection, see ISF & friends", "html");
    expect(HTML.slice(p.start, p.end)).toBe(
      "variable projection</b>, see <code>ISF</code> &amp; friends",
    );
    expect(p.context_before).toMatch(/Minimising over the rest is$/);
  });

  it("produces markers the HTML scanner pairs", () => {
    const p = locateAnchor(HTML, "too high over the evening", "html");
    const body = applyPlacement(HTML, p, 1);
    const file = parseForgemarkFile(
      body +
        "\n<!-- forgemark-comments\n- id: 1\n  anchor_text: x\n  author: A\n  timestamp: 2026-01-01T00:00:00Z\n  resolved: false\n  body: b\n-->\n",
      { format: "html" },
    );
    expect(file.comments).toHaveLength(1);
  });
});

describe("locateElement", () => {
  it("wraps a figure by id and describes it by caption", () => {
    const p = locateElement(HTML, "#fig-3", "html");
    expect(HTML.slice(p.start, p.end)).toMatch(/^<figure id="fig-3">.*<\/figure>$/);
    expect(p.anchor_kind).toBe("element");
    expect(p.anchor_selector).toBe("#fig-3");
    expect(p.anchor_text).toBe("Figure 3. Recovery");
  });

  it("describes a table without a caption by its text", () => {
    const p = locateElement(HTML, "#tbl-1", "html");
    expect(p.anchor_text).toBe("table: Day");
  });

  it("refuses unknown ids and Markdown files", () => {
    expect(() => locateElement(HTML, "#nope", "html")).toThrow(/No element matches/);
    expect(() => locateElement(MD, "#fig-3", "markdown")).toThrow(/HTML reports only/);
  });
});
