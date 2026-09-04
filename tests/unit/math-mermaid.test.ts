import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { createBlockSync, type BlockSync, type Serializer } from "../../src/components/blockSync";
import { splitBlocks } from "../../src/format/blocks";

let editor: Editor;
let sync: BlockSync;
const serializer = (): Serializer =>
  (editor.storage as unknown as { markdown: { serializer: Serializer } }).markdown.serializer;

function load(body: string) {
  sync = createBlockSync();
  editor.commands.setContent(sync.load(body), { emitUpdate: false });
  sync.settle(editor.state.doc);
}
const emit = () => sync.emit(editor.state.doc, serializer());
const dom = () => editor.view.dom;
const markdown = () =>
  (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("math", () => {
  it("draws inline TeX and writes it back", () => {
    load("Energy $E = mc^2$ here, but $5 and $6 are prices, and \\$7 too.\n");
    const math = dom().querySelectorAll(".fm-math");
    expect(math.length).toBe(1);
    expect(math[0].querySelector(".katex")).toBeTruthy();
    expect(math[0].getAttribute("data-fm-math")).toBe("E = mc^2");
    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.dispatch(editor.state.tr.insertText(" Yes.", end, end));
    // A dollar in prose is escaped on the way out, so it can never pair
    // with a later one and become math.
    expect(emit()).toBe(
      "Energy $E = mc^2$ here, but \\$5 and \\$6 are prices, and \\$7 too. Yes.\n",
    );
  });

  it("draws a $$ block and a math fence, each written back in its own form", () => {
    load("Before.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\na^2 + b^2 = c^2\n```\n\n$$ inline $$\n");
    const blocks = dom().querySelectorAll(".fm-math-block");
    expect(blocks.length).toBe(3);
    expect(blocks[0].querySelector(".katex-display")).toBeTruthy();
    expect(markdown()).toBe(
      "Before.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\na^2 + b^2 = c^2\n```\n\n$$\ninline\n$$",
    );
  });

  it("is one block to the splitter", () => {
    expect(splitBlocks("One.\n$$\nx\n$$\nTwo.\n").blocks.map((b) => b.text)).toEqual([
      "One.",
      "$$\nx\n$$",
      "Two.",
    ]);
  });

  it("shows bad TeX as an error rather than nothing", () => {
    load("$\\frac{$\n");
    expect(dom().querySelector(".fm-math .katex-error")).toBeTruthy();
  });
});

describe("mermaid", () => {
  it("holds the source, shows it until drawn, and writes the fence back", () => {
    load("```mermaid\ngraph TD; A-->B;\n```\n\nAfter.\n");
    expect(editor.state.doc.child(0).type.name).toBe("mermaidBlock");
    expect(dom().querySelector(".fm-mermaid .fm-mermaid-source")?.textContent).toBe(
      "graph TD; A-->B;",
    );
    expect(markdown()).toBe("```mermaid\ngraph TD; A-->B;\n```\n\nAfter.");
  });

  it("does not take other fences with it", () => {
    load("```js\nx()\n```\n");
    expect(editor.state.doc.child(0).type.name).toBe("codeBlock");
  });
});
