import { describe, it, expect } from "vitest";
import { buildHtmlTextMap, textRangeToSource } from "../../../src/format/html/textmap";
import { AnchorError, locateAnchor, applyPlacement } from "../../../src/format/locate";
import { normalizeAnchorText } from "../../../src/format/anchor-text";
import { lintText } from "../../../cli/lint";

// Generated reports often write blocks back to back — `<td>x</td><td>y</td>`
// — and a browser still shows their text apart. The text model must too,
// or a passage at a block's edge can't be found, a passage no reader sees
// ("xy") can, and a repeated one goes unnoticed. Reported by ForgeGraph.

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>\n`;
// The model's text, without the newline \`page\` ends the file with.
const textOf = (body: string) => buildHtmlTextMap(page(body)).text.trimEnd();

describe("the HTML text model at block edges", () => {
  it("puts a break between blocks that touch in the source", () => {
    expect(textOf("<p>alpha one</p><p>beta two</p>")).toBe("alpha one\nbeta two");
    expect(textOf("<table><tr><td>a</td><td>b</td></tr></table>")).toBe("a\nb");
    expect(textOf("<p>one<br>two</p>")).toBe("one\ntwo");
  });

  it("adds nothing where the source already has whitespace, or nothing follows", () => {
    expect(textOf("<p>alpha one</p>\n<p>beta two</p>")).toBe("alpha one\nbeta two");
    expect(textOf("<p>alone</p>")).toBe("alone");
    // Two edges in a row make one break.
    expect(textOf("<ul><li>a</li></ul><ul><li>b</li></ul>")).toBe("a\nb");
  });

  it("leaves inline elements joined, as a browser does", () => {
    expect(textOf("<p>alpha <b>beta</b>gamma</p>")).toBe("alpha betagamma");
  });

  it("maps a break to no source characters, so offsets around it are unchanged", () => {
    const html = page("<p>one</p><p>two</p>");
    const map = buildHtmlTextMap(html);
    const brk = map.text.indexOf("\n");
    expect(map.starts[brk]).toBe(map.ends[brk]);
    const two = map.text.indexOf("two");
    const range = textRangeToSource(map, two, two + 3, { requireExact: true });
    expect(html.slice(range!.start, range!.end)).toBe("two");
  });
});

describe("locating a passage at a block's edge", () => {
  const found = (body: string, phrase: string) => {
    const html = page(body);
    const p = locateAnchor(html, phrase, "html");
    return applyPlacement(html, p, 1);
  };

  it("finds the passages ForgeGraph could not", () => {
    expect(found("<p>alpha one</p><p>beta two</p>", "beta two")).toContain(
      "<p><!-- fmc:1 -->beta two<!-- /fmc:1 --></p>",
    );
    expect(found("<ul><li>alpha one</li><li>beta two</li></ul>", "beta two")).toContain(
      "<li><!-- fmc:1 -->beta two<!-- /fmc:1 --></li>",
    );
    expect(found("<div>alpha one</div><div>beta two</div>", "beta two")).toContain(
      "<div><!-- fmc:1 -->beta two<!-- /fmc:1 --></div>",
    );
    const cells = "<table><tr><td>alpha one</td><td>beta two</td></tr></table>";
    expect(found(cells, "alpha one")).toContain("<td><!-- fmc:1 -->alpha one<!-- /fmc:1 --></td>");
    expect(found(cells, "beta two")).toContain("<td><!-- fmc:1 -->beta two<!-- /fmc:1 --></td>");
    expect(found("<table><tr><td>alpha.</td><td>beta two</td></tr></table>", "beta two")).toContain(
      "<!-- fmc:1 -->beta two",
    );
  });

  it("no longer finds text a reader never sees", () => {
    const cells = page("<table><tr><td>alpha one</td><td>beta two</td></tr></table>");
    expect(() => locateAnchor(cells, "onebeta", "html")).toThrow(/not found/);
  });

  it("reports a passage repeated in two cells as appearing twice", () => {
    const html = page(
      "<table><tr><td>x</td><td>beta two</td></tr><tr><td>y.</td><td>beta two</td></tr></table>",
    );
    let error: unknown;
    try {
      locateAnchor(html, "beta two", "html");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AnchorError);
    expect((error as AnchorError).code).toBe("ambiguous");
    expect((error as AnchorError).count).toBe(2);
  });

  it("puts the app's selection of the first copy on the first copy", () => {
    // What the report bridge sends: the selected text and the words
    // either side, with a space between blocks.
    const html = page(
      "<table><tr><td>x</td><td>beta two</td></tr><tr><td>y.</td><td>beta two</td></tr></table>",
    );
    const p = locateAnchor(html, "beta two", "html", {
      near: { before: "x", after: "y. beta two" },
    });
    expect(p.start).toBe(html.indexOf("beta two"));
  });

  it("records a passage across two blocks as the reader reads it, and lint agrees", () => {
    const html = page("<table><tr><td>alpha one</td><td>beta two</td></tr></table>");
    const p = locateAnchor(html, "one beta", "html");
    expect(p.anchor_text).toBe("one beta");
    const body = applyPlacement(html, p, 1);
    const file =
      body +
      "<!-- forgemark-comments\n- id: 1\n  anchor_text: one beta\n  author: Sam\n" +
      "  timestamp: 2026-10-18T00:00:00Z\n  resolved: false\n  body: |\n    x\n-->\n";
    expect(lintText(file, "html").problems).toEqual([]);
  });

  it("reads anchor text with block edges as spaces and inline tags joined", () => {
    expect(normalizeAnchorText("one</td><td>beta", "html")).toBe("one beta");
    expect(normalizeAnchorText("one<br/>two", "html")).toBe("one two");
    expect(normalizeAnchorText("a<b>bc</b>d", "html")).toBe("abcd");
    // A tag that only starts like a block tag is not one.
    expect(normalizeAnchorText("one<preset>two", "html")).toBe("onetwo");
  });
});
