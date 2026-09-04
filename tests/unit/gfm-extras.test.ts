import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { createBlockSync, type BlockSync, type Serializer } from "../../src/components/blockSync";
import { splitBlocks } from "../../src/format/blocks";

// What GitHub renders beyond the GFM spec: alerts, footnotes, a single
// tilde, an escaped pipe in a table, and bare addresses. Each used to
// show as literal text and come back escaped, or broken, from an edit.

let editor: Editor;
let sync: BlockSync;
const serializer = (): Serializer =>
  (editor.storage as unknown as { markdown: { serializer: Serializer } }).markdown.serializer;

function load(body: string) {
  sync = createBlockSync();
  editor.commands.setContent(sync.load(body), { emitUpdate: false });
  sync.settle(editor.state.doc);
}

// Append text to the end of top-level node `index`, as typing does.
function typeAtEnd(index: number, text: string) {
  const doc = editor.state.doc;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const node = doc.child(index);
  const end = pos + node.nodeSize - 1;
  const inner = node.isTextblock ? end : end - 1;
  editor.view.dispatch(editor.state.tr.insertText(text, inner, inner));
}

const emit = () => sync.emit(editor.state.doc, serializer());
const dom = () => editor.view.dom;

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("alerts", () => {
  it("render the kind and keep it through an edit", () => {
    load("> [!NOTE]\n> Useful information.\n\n> [!WARNING]\n> Careful.\n\n> plain\n");
    const quotes = Array.from(dom().querySelectorAll("blockquote"));
    expect(quotes.map((q) => q.getAttribute("data-alert"))).toEqual(["note", "warning", null]);
    expect(quotes[0].getAttribute("data-alert-label")).toBe("Note");
    expect(quotes[0].textContent).toBe("Useful information.");
    typeAtEnd(0, " More.");
    expect(emit()).toBe(
      "> [!NOTE]\n> Useful information. More.\n\n> [!WARNING]\n> Careful.\n\n> plain\n",
    );
  });

  it("is one block to the splitter, marker line included", () => {
    expect(splitBlocks("> [!TIP]\n> One.\n\nTwo.\n").blocks.map((b) => b.text)).toEqual([
      "> [!TIP]\n> One.",
      "Two.",
    ]);
  });
});

describe("footnotes", () => {
  it("render the reference and the definition, and keep both through an edit", () => {
    load("Claim[^1] and[^note].\n\n[^1]: The note.\n[^note]: Second\nlazy line.\n\nAfter.\n");
    expect(
      Array.from(dom().querySelectorAll("sup.fm-footnote-ref")).map((s) => s.textContent),
    ).toEqual(["[1]", "[note]"]);
    expect(dom().querySelectorAll(".fm-footnote-def").length).toBe(2);
    expect(dom().querySelector(".fm-footnote-def .fm-footnote-body")?.textContent).toBe(
      "The note.",
    );
    typeAtEnd(0, " Yes.");
    typeAtEnd(1, " Really.");
    expect(emit()).toBe(
      "Claim[^1] and[^note]. Yes.\n\n[^1]: The note. Really.\n[^note]: Second\nlazy line.\n\nAfter.\n",
    );
  });

  it("lets a definition follow its sentence without a blank line", () => {
    expect(splitBlocks("Text[^1].\n[^1]: right after.\n").blocks.map((b) => b.text)).toEqual([
      "Text[^1].",
      "[^1]: right after.",
    ]);
  });

  it("keeps a real superscript a superscript", () => {
    load("x<sup>2</sup>[^1]\n");
    expect(dom().querySelector("sup:not(.fm-footnote-ref)")?.textContent).toBe("2");
    expect(dom().querySelector("sup.fm-footnote-ref")?.textContent).toBe("[1]");
  });
});

describe("a single tilde", () => {
  it("strikes, like two, and leaves a lone tilde alone", () => {
    load("This is ~struck~ and ~~double~~ and ~10ms and a ~ b ~ c and `~x~`.\n");
    expect(Array.from(dom().querySelectorAll("s")).map((s) => s.textContent)).toEqual([
      "struck",
      "double",
    ]);
    expect(dom().querySelector("code")?.textContent).toBe("~x~");
  });
});

describe("a pipe in a table cell", () => {
  it("stays escaped through an edit, in prose and in code", () => {
    load("| a | b |\n|---|---|\n| x \\| y | `a\\|b` |\n");
    expect(Array.from(dom().querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "x | y",
      "a|b",
    ]);
    const cell = dom().querySelector("td p");
    expect(cell).toBeTruthy();
    // Retype the table (any change to it rewrites the whole table).
    const pos = editor.view.posAtDOM(cell!, 0);
    editor.view.dispatch(editor.state.tr.insertText("z", pos, pos));
    expect(emit()).toBe("| a | b |\n| --- | --- |\n| zx \\| y | `a\\|b` |\n");
  });
});

describe("bare addresses", () => {
  it("link a scheme, www., or e-mail address, and nothing else", () => {
    load(
      "Visit www.example.com or https://x.y/a_b?c=1 or foo@bar.com or SKILL.md or example.com.\n",
    );
    expect(Array.from(dom().querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "http://www.example.com",
      "https://x.y/a_b?c=1",
      "mailto:foo@bar.com",
    ]);
  });

  it("are written back bare after an edit", () => {
    load("Visit www.example.com or https://x.y/a_b?c=1 or foo@bar.com or <https://a.b>.\n");
    typeAtEnd(0, " Now.");
    expect(emit()).toBe(
      "Visit www.example.com or https://x.y/a_b?c=1 or foo@bar.com or https://a.b. Now.\n",
    );
  });

  it("keep a titled or worded link as one", () => {
    load('See [t](https://c.d "T") and [www.e.f](http://www.e.f) and [here](https://g.h).\n');
    typeAtEnd(0, "!");
    expect(emit()).toBe('See [t](https://c.d "T") and www.e.f and [here](https://g.h).!\n');
  });
});
