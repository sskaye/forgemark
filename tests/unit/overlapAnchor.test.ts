// Bug 4 / report Bug 1 (overlap): bestOverlappingAnchorId is the gate that
// detects when a new-comment selection intersects an existing anchor, so
// the UI can divert to a reply instead of writing an unrepresentable
// overlapping marker pair.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { bestOverlappingAnchorId, crossesAnchorEdge } from "../../src/components/RenderedView";
import { bodyWithAnchorElements } from "../../src/format/markers-display";

function makeEditor(body: string): Editor {
  return new Editor({
    extensions: renderedExtensions(),
    content: bodyWithAnchorElements(body),
  });
}

// The positions of a substring of a single-paragraph doc. Anchor edges
// are nodes that take a position each, so the text is walked with them.
function range(editor: Editor, sub: string): { from: number; to: number } {
  const chars: { ch: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) chars.push({ ch: node.text[i], pos: pos + i });
    }
    return true;
  });
  const text = chars.map((c) => c.ch).join("");
  const i = text.indexOf(sub);
  if (i < 0) throw new Error(`substring not found: ${sub}`);
  return { from: chars[i].pos, to: chars[i + sub.length - 1].pos + 1 };
}

describe("bestOverlappingAnchorId", () => {
  it("returns null when the selection touches no anchor", () => {
    const editor = makeEditor("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const { from, to } = range(editor, "alpha");
    expect(bestOverlappingAnchorId(editor.state.doc, from, to)).toBe(null);
    editor.destroy();
  });

  it("detects a partial overlap with an existing anchor", () => {
    const editor = makeEditor("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const { from, to } = range(editor, "charlie delta");
    expect(bestOverlappingAnchorId(editor.state.doc, from, to)).toBe(5);
    editor.destroy();
  });

  it("detects a selection fully inside an existing anchor", () => {
    const editor = makeEditor("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const { from, to } = range(editor, "bravo");
    expect(bestOverlappingAnchorId(editor.state.doc, from, to)).toBe(5);
    editor.destroy();
  });

  it("picks the anchor with the most overlap when several intersect", () => {
    const editor = makeEditor(
      "<!-- fmc:1 -->aa<!-- /fmc:1 --> <!-- fmc:2 -->bravo charlie delta<!-- /fmc:2 --> ee",
    );
    // Selection spans the tail of anchor 1 and most of anchor 2.
    const { from, to } = range(editor, "a bravo charlie delta");
    expect(bestOverlappingAnchorId(editor.state.doc, from, to)).toBe(2);
    editor.destroy();
  });
});

describe("crossesAnchorEdge", () => {
  it("is false for a range wholly inside or wholly outside an anchor", () => {
    const editor = makeEditor("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const inside = range(editor, "bravo");
    expect(crossesAnchorEdge(editor.state.doc, inside.from, inside.to)).toBe(false);
    const outside = range(editor, "alpha");
    expect(crossesAnchorEdge(editor.state.doc, outside.from, outside.to)).toBe(false);
    const whole = range(editor, "bravo charlie");
    expect(crossesAnchorEdge(editor.state.doc, whole.from, whole.to)).toBe(false);
    editor.destroy();
  });

  it("is true for a range that holds an edge", () => {
    const editor = makeEditor("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const { from, to } = range(editor, "charlie delta");
    expect(crossesAnchorEdge(editor.state.doc, from, to)).toBe(true);
    editor.destroy();
  });
});
