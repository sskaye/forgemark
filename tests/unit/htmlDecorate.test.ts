// Display-time anchor decoration.
//
// The source is never rewritten for display — the browser has already
// parsed `<!-- fmc:N -->` into Comment nodes, so the highlight is built
// in the DOM. These tests work on a parsed document directly, which is
// exactly what the iframe hands the decorator.

import { describe, it, expect, beforeEach } from "vitest";
import { anchorElement, applyAnchorState, decorateAnchors } from "../../src/services/htmlDecorate";
import { renderedText, selectionTextRange, textIndexOf } from "../../src/services/htmlDom";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("decorateAnchors", () => {
  it("wraps an inline anchor's text so it can be highlighted", () => {
    const doc = parse("<p>Across <!-- fmc:1 -->fourteen interviews<!-- /fmc:1 -->, the rest.</p>");
    expect(decorateAnchors(doc)).toEqual([{ id: 1, kind: "inline" }]);
    const span = doc.querySelector("[data-anchor-id='1']");
    expect(span?.textContent).toBe("fourteen interviews");
  });

  it("wraps every text run when an anchor crosses tags", () => {
    const doc = parse("<p><!-- fmc:2 -->a <b>bold</b> tail<!-- /fmc:2 --></p>");
    expect(decorateAnchors(doc)).toEqual([{ id: 2, kind: "inline" }]);
    const spans = Array.from(doc.querySelectorAll("[data-anchor-id='2']"));
    expect(spans.map((s) => s.textContent)).toEqual(["a ", "bold", " tail"]);
  });

  it("marks the element itself for a block anchor", () => {
    // A full document, because that is what a splice produces: the
    // markers land around a figure that is already inside <body>. A bare
    // fragment starting with a comment is not representative — the
    // parser hoists that comment out of <body> entirely.
    const doc = parse(
      "<html><body><p>lead</p><!-- fmc:3 --><figure><figcaption>Figure 1. Control holds</figcaption><svg></svg></figure><!-- /fmc:3 --></body></html>",
    );
    expect(decorateAnchors(doc)).toEqual([{ id: 3, kind: "element" }]);
    const figure = doc.querySelector("figure");
    expect(figure?.getAttribute("data-anchor-id")).toBe("3");
    // The caption must not also be wrapped — the anchor is the figure.
    expect(doc.querySelectorAll("[data-anchor-id]")).toHaveLength(1);
  });

  it("leaves an unpaired marker alone", () => {
    const doc = parse("<p><!-- fmc:4 -->dangling</p>");
    expect(decorateAnchors(doc)).toEqual([]);
    expect(doc.querySelector("[data-anchor-id]")).toBeNull();
  });

  it("does not wrap text inside an svg, where an html span would not render", () => {
    const doc = parse(
      "<p><!-- fmc:5 -->before <svg><text>label</text></svg> after<!-- /fmc:5 --></p>",
    );
    decorateAnchors(doc);
    const wrapped = Array.from(doc.querySelectorAll("[data-anchor-id]")).map((s) => s.textContent);
    expect(wrapped).toEqual(["before ", " after"]);
  });

  it("reflects focus, hover and resolved state", () => {
    const doc = parse("<p><!-- fmc:6 -->x<!-- /fmc:6 --><!-- fmc:7 -->y<!-- /fmc:7 --></p>");
    decorateAnchors(doc);
    applyAnchorState(doc, 6, 7, new Set([7]));
    const six = anchorElement(doc, 6)!;
    const seven = anchorElement(doc, 7)!;
    expect(six.classList.contains("is-focused")).toBe(true);
    expect(six.classList.contains("is-hovered")).toBe(false);
    expect(seven.classList.contains("is-hovered")).toBe(true);
    expect(seven.classList.contains("is-resolved")).toBe(true);
  });
});

describe("htmlDom text coordinates", () => {
  let doc: Document;
  beforeEach(() => {
    doc = parse("<p>Across <b>fourteen</b> interviews</p><script>var hidden=1</script>");
  });

  it("excludes script content from the rendered text, matching the source map", () => {
    expect(renderedText(doc.body)).toBe("Across fourteen interviews");
  });

  it("locates a text node position in document coordinates", () => {
    const bold = doc.querySelector("b")!.firstChild!;
    expect(textIndexOf(doc.body, bold, 0)).toBe(7);
    expect(textIndexOf(doc.body, bold, 4)).toBe(11);
  });

  it("maps a selection range onto the shared coordinate", () => {
    const bold = doc.querySelector("b")!.firstChild!;
    const range = doc.createRange();
    range.setStart(bold, 0);
    range.setEnd(bold, 8);
    expect(selectionTextRange(doc.body, range)).toEqual({ from: 7, to: 15 });
  });

  it("stays correct after anchor spans split the text nodes", () => {
    // Decoration rewrites the tree; the coordinate must survive it,
    // which is why it is a character index and not a node reference.
    const before = renderedText(doc.body);
    const withAnchor = parse("<p>Across <!-- fmc:1 -->fourteen<!-- /fmc:1 --> interviews</p>");
    decorateAnchors(withAnchor);
    expect(renderedText(withAnchor.body)).toBe(before);
  });

  it("returns null for a collapsed selection", () => {
    const text = doc.querySelector("p")!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 2);
    expect(selectionTextRange(doc.body, range)).toBeNull();
  });
});
