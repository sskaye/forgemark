import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { createBlockSync, type BlockSync, type Serializer } from "../../src/components/blockSync";

// Typing rewrites only the block it touches. The body below holds every
// construct the editor cannot round-trip; each test edits one block and
// checks that everything else came back byte for byte.

const BODY = [
  "# Title",
  "",
  "A paragraph",
  "wrapped across",
  "lines, see [the docs][d].",
  "",
  "<!-- editors: keep the wrap -->",
  "",
  '<div align="center">',
  '<img src="x.png">',
  "</div>",
  "",
  "* star bullet",
  "* another",
  "",
  "| a | b |",
  "|:--|--:|",
  "| 1 | 2 |",
  "",
  "Setext",
  "======",
  "",
  "Claim[^1].",
  "",
  "[^1]: Note.",
  "",
  "    indented code",
  "",
  "Not \\*emphasis\\* here.",
  "",
  "<!-- fmc:3 -->",
  "```py",
  "x()",
  "```",
  "<!-- /fmc:3 -->",
  "",
  "Plain <!-- fmc:1 -->anchored<!-- /fmc:1 --> end.",
  "",
  "[d]: https://x.y",
  "",
].join("\n");

let editor: Editor;
let sync: BlockSync;
const serializer = (): Serializer =>
  (editor.storage as unknown as { markdown: { serializer: Serializer } }).markdown.serializer;

function load(body: string) {
  sync = createBlockSync();
  editor.commands.setContent(sync.load(body), { emitUpdate: false });
  sync.settle(editor.state.doc);
}

// Replace the text of top-level block `index` with `text`, the way
// typing does (one transaction on that block).
function retype(index: number, text: string) {
  const doc = editor.state.doc;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const node = doc.child(index);
  const tr = editor.state.tr.insertText(text, pos + 1, pos + node.nodeSize - 1);
  editor.view.dispatch(tr);
}

function emit(): string {
  return sync.emit(editor.state.doc, serializer());
}

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("block-level splicing", () => {
  it("shows one node per source block, raw HTML as verbatim", () => {
    load(BODY);
    const kinds: string[] = [];
    editor.state.doc.forEach((n) => kinds.push(n.type.name));
    expect(kinds.slice(0, 5)).toEqual([
      "heading",
      "paragraph",
      "verbatimBlock",
      "verbatimBlock",
      "bulletList",
    ]);
    expect(kinds).toContain("codeBlock");
  });

  it("returns the body unchanged when nothing changed", () => {
    load(BODY);
    expect(emit()).toBe(BODY);
  });

  it("rewrites only the edited paragraph, leaving wraps, links, HTML, and definitions", () => {
    load(BODY);
    retype(0, "Title, revised");
    const out = emit();
    expect(sync.lastMode()).toBe("splice");
    expect(out).toBe(BODY.replace("# Title", "# Title, revised"));
  });

  it("normalizes the edited block alone, and keeps the rest", () => {
    load(BODY);
    // The hard-wrapped paragraph with a reference link is the one edited:
    // it comes back unwrapped with the link inlined — that block's cost —
    // while the table's alignment, the escapes, the footnote, the star
    // bullets, and the HTML all stay as written.
    retype(1, "A paragraph rewritten.");
    const out = emit();
    expect(out).toBe(
      BODY.replace(
        "A paragraph\nwrapped across\nlines, see [the docs][d].",
        "A paragraph rewritten.",
      ),
    );
  });

  it("keeps an anchor's edges outside emphasis when its own block is edited", () => {
    load("Text <!-- fmc:1 -->**bold** and *em*<!-- /fmc:1 --> end.\n\nNext.\n");
    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.dispatch(editor.state.tr.insertText(" More.", end, end));
    expect(emit()).toBe(
      "Text <!-- fmc:1 -->**bold** and *em*<!-- /fmc:1 --> end. More.\n\nNext.\n",
    );
  });

  it("keeps a whole-block anchor and an inline anchor through an edit elsewhere", () => {
    load(BODY);
    retype(0, "New title");
    const out = emit();
    expect(out).toContain("<!-- fmc:3 -->\n```py\nx()\n```\n<!-- /fmc:3 -->");
    expect(out).toContain("Plain <!-- fmc:1 -->anchored<!-- /fmc:1 --> end.");
  });

  it("splices consecutive edits, each against the updated map", () => {
    load(BODY);
    retype(0, "First edit");
    let out = emit();
    expect(out).toContain("# First edit");
    // A second edit to a later block after the first was spliced.
    const idx = (() => {
      let i = 0;
      editor.state.doc.forEach((n, _pos, index) => {
        if (n.type.name === "heading" && n.textContent === "Setext") i = index;
      });
      return i;
    })();
    retype(idx, "Setext edited");
    out = emit();
    expect(sync.lastMode()).toBe("splice");
    expect(out).toContain("# First edit");
    expect(out).toContain("# Setext edited");
    expect(out).toContain("<!-- editors: keep the wrap -->");
    expect(out).toContain("[d]: https://x.y");
  });

  it("keeps splicing after the emitted body is loaded back, as the editor does", () => {
    // RenderedView hands each emitted body straight back to load(); that
    // used to drop the document being diffed against, so every keystroke
    // after the first fell back to rewriting the whole document.
    load(BODY);
    retype(0, "One");
    const first = emit();
    expect(sync.load(first)).toBe(sync.load(first));
    retype(0, "Two");
    const second = emit();
    expect(sync.lastMode()).toBe("splice");
    expect(second).toBe(BODY.replace("# Title", "# Two"));
    expect(second).toContain("* star bullet");
    expect(second).toContain("[d]: https://x.y");
  });

  it("inlines a reference link in an edited block instead of escaping it", () => {
    // The definition lives in a gap the editor never held, so the link
    // used to come back as literal brackets when its paragraph was edited.
    load(BODY);
    const doc = editor.state.doc;
    const end = doc.child(0).nodeSize + doc.child(1).nodeSize - 1;
    editor.view.dispatch(editor.state.tr.insertText(" Appended.", end, end));
    const out = emit();
    expect(out).toContain("[the docs](https://x.y). Appended.");
    expect(out).not.toContain("\\[");
    expect(out).toContain("[d]: https://x.y");
  });

  it("appends a new paragraph typed after the last block", () => {
    load("One.\n\nTwo.\n");
    // Move to the end and split off a new paragraph, as Enter does.
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    editor.commands.splitBlock();
    editor.commands.insertContent("Three.");
    const out = emit();
    expect(out).toBe("One.\n\nTwo.\n\nThree.\n");
  });

  it("removes a deleted block and closes the gap", () => {
    load("One.\n\nTwo.\n\nThree.\n");
    const doc = editor.state.doc;
    const start = doc.child(0).nodeSize;
    const tr = editor.state.tr.delete(start, start + doc.child(1).nodeSize);
    editor.view.dispatch(tr);
    expect(emit()).toBe("One.\n\nThree.\n");
  });

  it("falls back to whole-document serialization when the map cannot be trusted", () => {
    load("One.\n\nTwo.\n");
    // A document handed over without settle: nothing to diff against.
    sync = createBlockSync();
    sync.load("One.\n\nTwo.\n");
    retype(0, "Changed.");
    const out = sync.emit(editor.state.doc, serializer());
    expect(sync.lastMode()).toBe("whole");
    expect(out).toContain("Changed.");
    expect(out).toContain("Two.");
  });
});
