import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { renderedExtensions } from "../../src/components/editorExtensions";
import {
  anchorEdges,
  anchorEdgesTransaction,
  anchorRanges,
  plainText,
  strayEdges,
} from "../../src/components/AnchorEdge";
import { bodyWithAnchorElements } from "../../src/format/markers-display";

// Anchor edges are inline nodes. These tests cover what the node adds
// beyond parsing and serializing (editor-roundtrip.test.ts): placing a
// new pair, the highlight between a pair, and the three plugins that keep
// every edge paired while the reader types, deletes, and pastes.

let editor: Editor;

function load(body: string) {
  editor.commands.setContent(bodyWithAnchorElements(body), { emitUpdate: false });
}

function markdown(): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
}

// Positions of a substring, walking text nodes so edges are skipped.
function range(sub: string): { from: number; to: number } {
  const chars: { ch: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) chars.push({ ch: node.text[i], pos: pos + i });
    }
    return true;
  });
  const i = chars
    .map((c) => c.ch)
    .join("")
    .indexOf(sub);
  if (i < 0) throw new Error(`substring not found: ${sub}`);
  return { from: chars[i].pos, to: chars[i + sub.length - 1].pos + 1 };
}

function caret(pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

function anchor(sub: string, id: number) {
  const { from, to } = range(sub);
  editor.view.dispatch(anchorEdgesTransaction(editor.state, from, to, id));
}

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("placing a pair", () => {
  it("puts the edges around plain text", () => {
    load("alpha bravo charlie.");
    anchor("bravo", 7);
    expect(markdown()).toBe("alpha <!-- fmc:7 -->bravo<!-- /fmc:7 --> charlie.");
  });

  it("puts the edges outside emphasis the selection covers", () => {
    load("Text **bold** and *em* end.");
    anchor("bold and em", 1);
    expect(markdown()).toBe("Text <!-- fmc:1 -->**bold** and *em*<!-- /fmc:1 --> end.");
  });

  it("puts the edges inside emphasis the selection sits within", () => {
    load("Text **bold and more** end.");
    anchor("and", 1);
    expect(markdown()).toBe("Text **bold <!-- fmc:1 -->and<!-- /fmc:1 --> more** end.");
  });

  it("moves an edge that would land inside inline code to the code's boundary", () => {
    load("Call `foo()` and then `bar()` here.");
    const { from } = range("o() and");
    const { to } = range("bar");
    editor.view.dispatch(anchorEdgesTransaction(editor.state, from, to, 2));
    expect(markdown()).toBe("Call <!-- fmc:2 -->`foo()` and then `bar()`<!-- /fmc:2 --> here.");
  });
});

describe("the highlight between a pair", () => {
  it("carries the anchor id on the passage and nothing on the edges", () => {
    load("alpha <!-- fmc:5 -->bravo **charlie**<!-- /fmc:5 --> delta");
    const dom = editor.view.dom;
    const highlighted = Array.from(dom.querySelectorAll("[data-anchor-id='5']"));
    expect(highlighted.map((el) => el.textContent).join("")).toBe("bravo charlie");
    expect(dom.querySelector("fm-anchor")?.hasAttribute("data-anchor-id")).toBe(false);
  });

  it("follows the text as it is edited", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    const { to } = range("bravo");
    caret(to);
    editor.commands.insertContent(" charlie");
    const highlighted = Array.from(editor.view.dom.querySelectorAll("[data-anchor-id='5']"));
    expect(highlighted.map((el) => el.textContent).join("")).toBe("bravo charlie");
    expect(markdown()).toBe("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
  });

  it("spans paragraphs when the pair does", () => {
    load("One <!-- fmc:1 -->two.\n\nThree<!-- /fmc:1 --> four.");
    const highlighted = Array.from(editor.view.dom.querySelectorAll("[data-anchor-id='1']"));
    expect(highlighted.map((el) => el.textContent)).toEqual(["two.", "Three"]);
  });
});

describe("Backspace and Delete beside an edge", () => {
  it("Backspace after the close edge removes the last anchored character", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    caret(range("bravo").to + 1);
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(markdown()).toBe("alpha <!-- fmc:5 -->brav<!-- /fmc:5 --> delta");
  });

  it("Backspace after the open edge removes the character before the anchor", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    caret(range("bravo").from);
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(markdown()).toBe("alpha<!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
  });

  it("Delete before the open edge removes the first anchored character", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    caret(range("bravo").from - 1);
    expect(editor.commands.keyboardShortcut("Delete")).toBe(true);
    expect(markdown()).toBe("alpha <!-- fmc:5 -->ravo<!-- /fmc:5 --> delta");
  });

  it("Delete before the close edge removes the character after the anchor", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    caret(range("bravo").to);
    expect(editor.commands.keyboardShortcut("Delete")).toBe(true);
    expect(markdown()).toBe("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 -->delta");
  });

  it("removes a whole astral character, not half of it", () => {
    load("go <!-- fmc:5 -->now 🎉<!-- /fmc:5 --> ok");
    caret(range("now 🎉").to + 1);
    editor.commands.keyboardShortcut("Backspace");
    expect(markdown()).toBe("go <!-- fmc:5 -->now <!-- /fmc:5 --> ok");
  });

  it("leaves a Backspace inside the text to the editor", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    caret(range("bravo").from + 2);
    // Nothing of ours handles it; headless, nothing else deletes either.
    editor.commands.keyboardShortcut("Backspace");
    expect(markdown()).toBe("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
  });
});

describe("keeping every edge paired", () => {
  it("removes the partner of an edge a deletion swallowed", () => {
    load("alpha <!-- fmc:5 -->bravo charlie<!-- /fmc:5 --> delta");
    const { from } = range("charlie");
    const { to } = range("delta");
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(anchorEdges(editor.state.doc)).toEqual([]);
    expect(markdown()).toBe("alpha bravo ");
  });

  it("removes a pair that has nothing left between its edges", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    const { from, to } = range("bravo");
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(markdown()).toBe("alpha  delta");
  });

  it("keeps the other anchors when one loses an edge", () => {
    load("<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 --> end");
    const { from } = range("wo");
    const { from: to } = range("end");
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(markdown()).toBe("<!-- fmc:1 -->one<!-- /fmc:1 --> and tend");
  });

  it("names the strays in a document", () => {
    load("a <!-- fmc:1 -->b<!-- /fmc:1 --> c");
    const doc = editor.state.doc;
    expect(strayEdges(doc)).toEqual([]);
    expect(anchorRanges(doc)).toEqual([{ id: 1, from: 4, to: 5 }]);
  });
});

describe("pasting", () => {
  function pasted(slice: Slice): Slice {
    const view = editor.view as EditorView;
    return view.someProp("transformPasted", (f) => f(slice, view, false)) ?? slice;
  }

  function edgeCount(node: PMNode | Slice): number {
    let n = 0;
    (node instanceof Slice ? node.content : node.content).descendants((child) => {
      if (child.type.name === "anchorEdge") n++;
      return true;
    });
    return n;
  }

  it("drops the edges of an anchor the document already has", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    const { from, to } = range("bravo");
    const copy = editor.state.doc.slice(from - 1, to + 1);
    expect(edgeCount(copy)).toBe(2);
    expect(edgeCount(pasted(copy))).toBe(0);
  });

  it("keeps the edges of an anchor that was cut, so a move keeps its comment", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    const { from, to } = range("bravo");
    const cut = editor.state.doc.slice(from - 1, to + 1);
    editor.view.dispatch(editor.state.tr.delete(from - 1, to + 1));
    expect(edgeCount(pasted(cut))).toBe(2);
  });
});

describe("plainText", () => {
  it("reads through edges without adding spaces", () => {
    load("alpha <!-- fmc:5 -->bravo<!-- /fmc:5 --> delta");
    expect(plainText(editor.state.doc, 1, editor.state.doc.content.size - 1)).toBe(
      "alpha bravo delta",
    );
  });
});
