// HTML marker scanning.
//
// The premise of HTML support is that the storage format needs no
// syntax change: `<!-- fmc:N -->` is already valid HTML. What does need
// changing is *where* a marker is recognised. These tests pin both the
// two places the Markdown scanner gets HTML wrong, and the two places a
// naive regex sweep would get it wrong.

import { describe, it, expect } from "vitest";
import { findMarkers, findMarkersHtml, pairMarkers } from "../../../src/format/markers";

describe("findMarkersHtml", () => {
  it("finds a marker on an indented line", () => {
    // The Markdown scanner treats 4+ leading spaces after a blank line as
    // an indented code block and skips it. HTML is indented as a matter
    // of course, so that rule makes markers invisible.
    const src = ["<div>", "", "    <p><!-- fmc:2 -->hi<!-- /fmc:2 --></p>", "</div>", ""].join("\n");
    expect(findMarkers(src, "markdown")).toHaveLength(0);
    expect(findMarkers(src, "html").map((m) => m.type)).toEqual(["open", "close"]);
  });

  it("finds a marker on a line containing a backtick", () => {
    const src = "<p>the ` character <!-- fmc:3 -->matters<!-- /fmc:3 --> here</p>\n";
    expect(pairMarkers(findMarkers(src, "html")).pairs).toHaveLength(1);
  });

  it("ignores marker-shaped text inside <script>", () => {
    const src = "<script>var s = '<!-- fmc:4 -->';</script>\n";
    expect(findMarkersHtml(src)).toHaveLength(0);
  });

  it("ignores marker-shaped text inside <style>, <title> and <textarea>", () => {
    const src = [
      "<title><!-- fmc:1 --></title>",
      "<style>/* <!-- fmc:2 --> */</style>",
      "<textarea><!-- fmc:3 --></textarea>",
      "",
    ].join("\n");
    expect(findMarkersHtml(src)).toHaveLength(0);
  });

  it("ignores marker-shaped text inside an attribute value", () => {
    const src = '<p title="<!-- fmc:5 -->" data-x=\'<!-- fmc:6 -->\'>real</p>\n';
    expect(findMarkersHtml(src)).toHaveLength(0);
  });

  it("is not fooled by a > inside an attribute value", () => {
    const src = '<p title="a > b"><!-- fmc:7 -->text<!-- /fmc:7 --></p>\n';
    expect(pairMarkers(findMarkersHtml(src)).pairs).toHaveLength(1);
  });

  it("resumes scanning after a raw-text element closes", () => {
    const src = "<style>p{}</style><p><!-- fmc:8 -->x<!-- /fmc:8 --></p>\n";
    const pairs = pairMarkers(findMarkersHtml(src)).pairs;
    expect(pairs).toHaveLength(1);
    expect(src.slice(pairs[0].open.end, pairs[0].close.start)).toBe("x");
  });

  it("skips ordinary comments, doctypes and CDATA without emitting markers", () => {
    const src = [
      "<!doctype html>",
      "<!-- an ordinary comment mentioning fmc:9 -->",
      "<svg><![CDATA[ <!-- fmc:10 --> ]]></svg>",
      "<p><!-- fmc:11 -->kept<!-- /fmc:11 --></p>",
      "",
    ].join("\n");
    const markers = findMarkersHtml(src);
    expect(markers.map((m) => m.id)).toEqual([11, 11]);
  });

  it("reports offsets that slice the anchored text back out", () => {
    const src = "<p>Across <!-- fmc:1 -->fourteen interviews<!-- /fmc:1 -->, the rest.</p>\n";
    const [pair] = pairMarkers(findMarkersHtml(src)).pairs;
    expect(src.slice(pair.open.end, pair.close.start)).toBe("fourteen interviews");
  });

  it("does not run off the end on unterminated markup", () => {
    expect(() => findMarkersHtml("<p><span class=\"x")).not.toThrow();
    expect(() => findMarkersHtml("<!-- unterminated")).not.toThrow();
    expect(() => findMarkersHtml("<script>never closed")).not.toThrow();
  });
});
