// Bug 4 / report Bug 1 (overlap): bestOverlappingAnchorId is the gate that
// detects when a new-comment selection intersects an existing anchor, so
// the UI can divert to a reply instead of writing an unrepresentable
// overlapping marker pair.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { AnchorMark } from "../../src/components/AnchorMark";
import { bestOverlappingAnchorId } from "../../src/components/RenderedView";
import { bodyWithAnchorSpans } from "../../src/format/markers-display";

function makeEditor(body: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      AnchorMark,
      Markdown.configure({ html: true }),
    ],
    content: bodyWithAnchorSpans(body),
  });
}

// In a single-paragraph doc, text offset i maps to ProseMirror pos 1 + i.
function range(editor: Editor, sub: string): { from: number; to: number } {
  const text = editor.state.doc.textBetween(1, editor.state.doc.content.size - 1, "", "");
  const i = text.indexOf(sub);
  if (i < 0) throw new Error(`substring not found: ${sub}`);
  return { from: 1 + i, to: 1 + i + sub.length };
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
