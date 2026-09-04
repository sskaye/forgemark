import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { createBlockSync, type BlockSync, type Serializer } from "../../src/components/blockSync";
import { plainText } from "../../src/components/AnchorEdge";
import { renderInlineHtml } from "../../src/components/HtmlInline";

// Inline HTML in a paragraph the reader edits. GitHub renders these
// tags; the editor used to keep their text and drop the tags on the
// first keystroke in that paragraph.

let editor: Editor;
let sync: BlockSync;
const serializer = (): Serializer =>
  (editor.storage as unknown as { markdown: { serializer: Serializer } }).markdown.serializer;

function load(body: string) {
  sync = createBlockSync();
  editor.commands.setContent(sync.load(body), { emitUpdate: false });
  sync.settle(editor.state.doc);
}

// Append text to the first paragraph, as typing at its end does.
function typeAtEnd(text: string) {
  const end = editor.state.doc.child(0).nodeSize - 1;
  editor.view.dispatch(editor.state.tr.insertText(text, end, end));
}

const emit = () => sync.emit(editor.state.doc, serializer());

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("inline HTML tags GitHub styles", () => {
  it("render as their element and survive an edit", () => {
    load('Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to <mark>copy</mark>, <abbr title="x">abbr</abbr>.\n');
    const dom = editor.view.dom;
    expect(dom.querySelectorAll("kbd").length).toBe(2);
    expect(dom.querySelector("mark")?.textContent).toBe("copy");
    expect(dom.querySelector("abbr")?.getAttribute("title")).toBe("x");
    typeAtEnd(" Done.");
    expect(emit()).toBe(
      'Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to <mark>copy</mark>, <abbr title="x">abbr</abbr>. Done.\n',
    );
  });

  it("keep nesting and a span's attributes", () => {
    load('Nested <kbd><small>x</small></kbd> and <span style="color:red">red</span>.\n');
    typeAtEnd("!");
    expect(emit()).toBe(
      'Nested <kbd><small>x</small></kbd> and <span style="color:red">red</span>.!\n',
    );
  });

  it("keep an event handler for the file but not for the page", () => {
    load('A <span onclick="x()" class="c">b</span>.\n');
    const span = editor.view.dom.querySelector("p span");
    expect(span?.getAttribute("class")).toBe("c");
    expect(span?.hasAttribute("onclick")).toBe(false);
    typeAtEnd("!");
    expect(emit()).toBe('A <span onclick="x()" class="c">b</span>.!\n');
  });

  it("leave the editor's own spans alone when its HTML is parsed back", () => {
    load("Plain <!-- fmc:1 -->anchored<!-- /fmc:1 --> text.\n");
    // Parsing the rendered HTML back, as a paste from the editor does,
    // must not turn a highlight span into a document span.
    editor.commands.setContent(editor.getHTML(), { emitUpdate: false });
    const md = (
      editor.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
    expect(md).toBe("Plain <!-- fmc:1 -->anchored<!-- /fmc:1 --> text.");
  });
});

describe("inline HTML the editor cannot hold", () => {
  it("keeps a comment, a void tag, and an unknown tag through an edit", () => {
    load('Line <!-- note --> and a<wbr>b and <video src="a.mp4" controls></video> done.\n');
    expect(editor.view.dom.querySelectorAll("fm-html").length).toBe(4);
    expect(editor.view.dom.textContent).toBe("Line  and ab and  done.");
    typeAtEnd(" More.");
    expect(emit()).toBe(
      'Line <!-- note --> and a<wbr>b and <video src="a.mp4" controls></video> done. More.\n',
    );
  });

  it("contributes nothing to the text of a selection", () => {
    load("Line <!-- note --> end.\n");
    expect(plainText(editor.state.doc, 1, editor.state.doc.child(0).nodeSize - 1)).toBe(
      "Line  end.",
    );
  });

  it("decides per tag what the editor is handed", () => {
    expect(renderInlineHtml("<kbd>")).toBe("<kbd>");
    expect(renderInlineHtml("</kbd>")).toBe("</kbd>");
    expect(renderInlineHtml('<img src="x">')).toBe('<img src="x">');
    expect(renderInlineHtml("<!-- c -->")).toMatch(/^<fm-html data-src=/);
    expect(renderInlineHtml("<video>")).toMatch(/^<fm-html data-src=/);
  });
});

describe("inline images", () => {
  it("keep a link around an image", () => {
    load("[![badge](https://img.shields.io/x.svg)](https://x.y) built\n");
    expect(editor.view.dom.querySelector("a img")).toBeTruthy();
    typeAtEnd(" nightly");
    expect(emit()).toBe("[![badge](https://img.shields.io/x.svg)](https://x.y) built nightly\n");
  });

  it("keep an image in its sentence, with its width", () => {
    load('Icon <img src="a.png" alt="A" width="20"> here and ![b](b.png "T") there.\n');
    expect(editor.view.dom.querySelectorAll("p img").length).toBe(2);
    typeAtEnd("!");
    expect(emit()).toBe(
      'Icon <img src="a.png" alt="A" width="20"> here and ![b](b.png "T") there.!\n',
    );
  });
});
