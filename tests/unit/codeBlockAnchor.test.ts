// Bug 3 (deeper change): whole-code-block commenting. Markers can't live
// inside a fence, so a code-block comment is stored as a marker pair around
// the fence and carried in the editor as a codeBlock `anchorId` attribute.
// These tests drive the real extension set (as RenderedView configures it)
// plus the classifier and the display pre-process.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { AnchorMark } from "../../src/components/AnchorMark";
import { CodeBlockAnchor } from "../../src/components/CodeBlockAnchor";
import { classifyCodeSelection } from "../../src/components/RenderedView";
import {
  bodyWithAnchorSpans,
  bodyFromAnchorSpans,
  blockAnchorsToInfoString,
} from "../../src/format/markers-display";
import { parseForgemarkFile } from "../../src/format/parser";
import { serializeForgemarkFile } from "../../src/format/serializer";
import type { Comment } from "../../src/format/types";
import type { Node as PMNode } from "@tiptap/pm/model";

function makeEditor(body: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      CodeBlockAnchor,
      Link.configure({ openOnClick: false }),
      AnchorMark,
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
    ],
    content: bodyWithAnchorSpans(body),
  });
}

function codeBlockRange(editor: Editor): { start: number; end: number } {
  let r: { start: number; end: number } | null = null;
  editor.state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name === "codeBlock") r = { start: pos, end: pos + node.nodeSize };
  });
  if (!r) throw new Error("no code block");
  return r;
}

function getMd(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return bodyFromAnchorSpans(storage.markdown?.getMarkdown?.() ?? "");
}

const PY = "```python\nprint('hi')\n```";

describe("blockAnchorsToInfoString", () => {
  it("moves a block anchor id into the fence info string", () => {
    const body = `<!-- fmc:4 -->\n${PY}\n<!-- /fmc:4 -->`;
    expect(blockAnchorsToInfoString(body)).toBe("```python fmc=4\nprint('hi')\n```");
  });

  it("handles a fence with no language", () => {
    const body = "<!-- fmc:4 -->\n```\nx\n```\n<!-- /fmc:4 -->";
    expect(blockAnchorsToInfoString(body)).toBe("```fmc=4\nx\n```");
  });

  it("leaves an unanchored fence untouched", () => {
    expect(blockAnchorsToInfoString(PY)).toBe(PY);
  });
});

describe("classifyCodeSelection", () => {
  it("classifies a selection inside a code block as a whole-block anchor", () => {
    const editor = makeEditor(`Intro.\n\n${PY}`);
    const { start, end } = codeBlockRange(editor);
    const cls = classifyCodeSelection(editor.state.doc, start + 2, end - 2);
    expect(cls.kind).toBe("block");
    if (cls.kind === "block") {
      expect(cls.text).toBe("print('hi')");
      expect(cls.existingAnchorId).toBe(null);
    }
    editor.destroy();
  });

  it("detects an existing block anchor as the overlap target", () => {
    const editor = makeEditor(`Intro.\n\n<!-- fmc:9 -->\n${PY}\n<!-- /fmc:9 -->`);
    const { start, end } = codeBlockRange(editor);
    const cls = classifyCodeSelection(editor.state.doc, start + 1, end - 1);
    expect(cls.kind).toBe("block");
    if (cls.kind === "block") expect(cls.existingAnchorId).toBe(9);
    editor.destroy();
  });

  it("rejects a selection entirely inside inline code", () => {
    const editor = makeEditor("Run `npm test` now.");
    const text = editor.state.doc.textBetween(1, editor.state.doc.content.size - 1, "", "");
    const i = text.indexOf("npm test");
    const cls = classifyCodeSelection(editor.state.doc, 1 + i, 1 + i + "npm test".length);
    expect(cls.kind).toBe("reject");
    editor.destroy();
  });

  it("allows a mixed prose + inline code selection", () => {
    const editor = makeEditor("Run `npm test` now.");
    const text = editor.state.doc.textBetween(1, editor.state.doc.content.size - 1, "", "");
    const i = text.indexOf("Run `npm");
    // "Run npm test" spans prose + the inline code run.
    const cls = classifyCodeSelection(editor.state.doc, 1, 1 + "Run npm test".length);
    expect(cls.kind).toBe("inline");
    editor.destroy();
    void i;
  });

  it("rejects a selection that straddles a code-block boundary", () => {
    const editor = makeEditor(`Intro line.\n\n${PY}`);
    const { end } = codeBlockRange(editor);
    // from inside the intro paragraph, to inside the code block.
    const cls = classifyCodeSelection(editor.state.doc, 2, end - 2);
    expect(cls.kind).toBe("reject");
    editor.destroy();
  });
});

describe("whole-block anchor round-trip", () => {
  it("anchoring a code block serializes to markers around the fence and parses", () => {
    const editor = makeEditor(`Intro.\n\n${PY}`);
    const { start, end } = codeBlockRange(editor);
    editor
      .chain()
      .setTextSelection({ from: start + 1, to: end - 1 })
      .updateAttributes("codeBlock", { anchorId: "3" })
      .run();
    const newBody = getMd(editor);
    editor.destroy();

    // One marker pair, on their own lines around the fence.
    expect(newBody).toMatch(/<!-- fmc:3 -->\n```python\nprint\('hi'\)\n```\n<!-- \/fmc:3 -->/);
    expect((newBody.match(/<!--\s*fmc:3\s*-->/g) ?? []).length).toBe(1);

    const record: Comment = {
      id: 3,
      anchor_text: "print('hi')",
      context_before: "",
      context_after: "",
      author: "T",
      timestamp: "2026-06-21T00:00:00Z",
      resolved: false,
      body: "explain this block",
    };
    const file = serializeForgemarkFile({ body: newBody, comments: [record] });
    expect(() => parseForgemarkFile(file)).not.toThrow();
  });

  it("an anchored block survives a display round-trip (markers ⇄ info string)", () => {
    const stored = `Intro.\n\n<!-- fmc:7 -->\n${PY}\n<!-- /fmc:7 -->`;
    const editor = makeEditor(stored);
    // The pre carries the anchor id for click/focus wiring.
    expect(editor.getHTML()).toContain('data-anchor-id="7"');
    // Serializing back yields the stored marker form again.
    const out = getMd(editor);
    editor.destroy();
    expect(out).toMatch(/<!-- fmc:7 -->\n```python\nprint\('hi'\)\n```\n<!-- \/fmc:7 -->/);
  });
});
