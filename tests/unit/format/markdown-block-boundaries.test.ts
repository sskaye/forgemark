import { describe, it, expect } from "vitest";
import { locateAnchor, applyPlacement } from "../../../src/format/locate";
import { normalizeAnchorText, inMarkdownTable, spansBlocks } from "../../../src/format/anchor-text";
import { reattachOrphans } from "../../../src/format/reattachAll";
import { lintText } from "../../../cli/lint";
import type { Comment } from "../../../src/format/types";

// A reader can select across two list items, two table cells, a quote's
// lines, or a heading and the paragraph under it. The passage they read
// is "one beta"; the source between the markers is "one\n- beta" or
// "one | beta". Recording, lint and re-attachment must read the source
// as the reader does, or the comment drifts on its first lint and can't
// be found again once its markers are lost.

const DOCS: Record<string, string> = {
  list: "Intro.\n\n- alpha one\n- beta two\n",
  ordered: "Intro.\n\n1. alpha one\n2. beta two\n",
  tasks: "Intro.\n\n- [ ] alpha one\n- [x] beta two\n",
  quote: "Intro.\n\n> alpha one\n> beta two\n",
  table: "Intro.\n\n| a | b |\n| --- | --- |\n| alpha one | beta two |\n",
  heading: "Intro.\n\n## Alpha one\n\nbeta two\n",
};

function record(id: number, anchor_text: string): Comment {
  return {
    id,
    anchor_text,
    author: "Sam",
    timestamp: "2026-10-18T00:00:00Z",
    resolved: false,
    body: "x\n",
  };
}

const withBlock = (body: string, c: Comment) =>
  `${body}\n<!-- forgemark-comments\n- id: ${c.id}\n  anchor_text: "${c.anchor_text}"\n` +
  `  author: Sam\n  timestamp: 2026-10-18T00:00:00Z\n  resolved: false\n  body: |\n    x\n-->\n`;

describe("a Markdown passage across two blocks", () => {
  for (const [name, doc] of Object.entries(DOCS)) {
    it(`is found, recorded as read, linted clean, and re-attached: ${name}`, () => {
      const p = locateAnchor(doc, "one beta", "markdown");
      expect(p.anchor_text.toLowerCase()).toBe("one beta");
      const body = applyPlacement(doc, p, 1);
      expect(body.replace(/<!--\s*\/?fmc:1\s*-->/g, "")).toBe(doc);
      // As the app records it: the selection's text.
      expect(lintText(withBlock(body, record(1, "one beta")), "markdown").problems).toEqual([]);
      const { outcomes } = reattachOrphans(
        { body: doc, comments: [record(1, "one beta")] },
        "markdown",
      );
      expect(outcomes[0]).toMatchObject({ outcome: "attached" });
    });
  }

  it("still reads a pipe in prose as text", () => {
    expect(normalizeAnchorText("a | b", "markdown")).toBe("a | b");
    expect(normalizeAnchorText("one | beta", "markdown", { inTable: true })).toBe("one beta");
    const doc = "Run `ls | wc` or pick a | b here.\n";
    expect(locateAnchor(doc, "pick a | b", "markdown").anchor_text).toBe("pick a | b");
  });

  it("knows a table from a paragraph with a pipe or a setext heading", () => {
    const doc = "Prose | with a pipe.\n\nHeading\n---\n\n| a | b |\n|---|---|\n| x | y |\n";
    expect(inMarkdownTable(doc, doc.indexOf("Prose"))).toBe(false);
    expect(inMarkdownTable(doc, doc.indexOf("Heading"))).toBe(false);
    expect(inMarkdownTable(doc, doc.indexOf("| x"))).toBe(true);
    expect(inMarkdownTable(doc, doc.indexOf("| a"))).toBe(true);
  });

  it("leaves emphasis and a leading minus sign alone", () => {
    expect(normalizeAnchorText("x *emph*\n*more*", "markdown")).toBe("x emph more");
    expect(normalizeAnchorText("x\n-1 below", "markdown")).toBe("x -1 below");
  });
});

describe("spansBlocks: whether a suggestion would merge blocks", () => {
  const spans = (
    body: string,
    from: string,
    to: string,
    format: "markdown" | "html" = "markdown",
  ) => spansBlocks(body, body.indexOf(from), body.indexOf(to) + to.length, format);

  it("is true across paragraphs, list items, cells, headings, and a quote's blank line", () => {
    expect(spans("alpha one\n\nbeta two\n", "one", "beta")).toBe(true);
    expect(spans("- alpha one\n- beta two\n", "one", "beta")).toBe(true);
    expect(spans("| a | b |\n|---|---|\n| alpha one | beta two |\n", "one", "beta")).toBe(true);
    expect(spans("## Alpha one\nbeta two\n", "one", "beta")).toBe(true);
    expect(spans("Alpha one\n---\nbeta two\n", "one", "beta")).toBe(true);
    expect(spans("> alpha one\n>\n> beta two\n", "one", "beta")).toBe(true);
    expect(spans("<p>alpha one</p><p>beta two</p>", "one", "beta", "html")).toBe(true);
  });

  it("is false inside one block, however it is wrapped", () => {
    expect(spans("alpha one\nbeta two\n", "one", "beta")).toBe(false);
    expect(spans("> alpha one\n> beta two\n", "one", "beta")).toBe(false);
    expect(spans("- alpha one\n  beta two\n", "one", "beta")).toBe(false);
    expect(spans("pick a | b here\n", "a", "b")).toBe(false);
    expect(spans("<p>alpha <b>one</b> beta</p>", "one", "beta", "html")).toBe(false);
  });
});
