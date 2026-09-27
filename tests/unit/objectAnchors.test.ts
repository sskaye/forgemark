// Comments on objects that are not plain text. An inline object (an
// equation, an image) is anchored like text, with an edge either side
// of the atom, and reads as its TeX or alt text. A block the file cannot
// put markers inside (a code block, an equation, a diagram) is anchored
// whole: markers on their own lines around it, carried in the editor as
// the node's `anchorId` (src/components/BlockAnchor.ts).

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { classifyCodeSelection } from "../../src/components/RenderedView";
import { anchorEdgesTransaction, plainText } from "../../src/components/AnchorEdge";
import { bodyWithAnchorElements, blockAnchorsToInfoString } from "../../src/format/markers-display";
import { splitBlocks } from "../../src/format/blocks";
import { anchorTextMatches } from "../../src/format/anchor-text";

function makeEditor(body: string): Editor {
  return new Editor({ extensions: renderedExtensions(), content: bodyWithAnchorElements(body) });
}

function getMd(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
}

function find(editor: Editor, name: string): { pos: number; node: PMNode } {
  let hit: { pos: number; node: PMNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!hit && node.type.name === name) hit = { pos, node };
  });
  if (!hit) throw new Error(`no ${name}`);
  return hit;
}

const BLOCK = "$$\nE = mc^2\n$$";
const MERMAID = "```mermaid\ngraph TD\n  A --> B\n```";
const FENCE = "```math\na^2 + b^2 = c^2\n```";

describe("blockAnchorsToInfoString with equations", () => {
  it("moves the id onto a $$ block's opening line", () => {
    expect(blockAnchorsToInfoString(`<!-- fmc:4 -->\n${BLOCK}\n<!-- /fmc:4 -->`)).toBe(
      "$$ fmc=4\nE = mc^2\n$$",
    );
  });

  it("moves the id into a math fence's info string", () => {
    expect(blockAnchorsToInfoString(`<!-- fmc:4 -->\n${FENCE}\n<!-- /fmc:4 -->`)).toBe(
      "```math fmc=4\na^2 + b^2 = c^2\n```",
    );
  });

  it("keeps a list item's indent", () => {
    const body = "1. Item:\n\n   <!-- fmc:2 -->\n   $$\n   x\n   $$\n   <!-- /fmc:2 -->\n";
    expect(blockAnchorsToInfoString(body)).toBe("1. Item:\n\n   $$ fmc=2\n   x\n   $$\n");
  });
});

describe("block equations", () => {
  it("classifies a selected equation as a whole-block anchor with its TeX", () => {
    const editor = makeEditor(`Intro.\n\n${BLOCK}`);
    const { pos, node } = find(editor, "mathBlock");
    const cls = classifyCodeSelection(editor.state.doc, pos, pos + node.nodeSize);
    expect(cls).toMatchObject({ kind: "block", pos, text: "E = mc^2", existingAnchorId: null });
    editor.destroy();
  });

  it("rejects a selection that runs from prose into an equation", () => {
    const editor = makeEditor(`Intro.\n\n${BLOCK}`);
    const { pos, node } = find(editor, "mathBlock");
    expect(classifyCodeSelection(editor.state.doc, 2, pos + node.nodeSize).kind).toBe("reject");
    editor.destroy();
  });

  for (const [name, src] of [
    ["$$ block", BLOCK],
    ["math fence", FENCE],
  ]) {
    it(`writes an anchored ${name} back with markers around it`, () => {
      const stored = `Intro.\n\n<!-- fmc:7 -->\n${src}\n<!-- /fmc:7 -->`;
      const editor = makeEditor(stored);
      expect(find(editor, "mathBlock").node.attrs.anchorId).toBe("7");
      expect(editor.view.dom.querySelector('.fm-math-block[data-anchor-id="7"]')).toBeTruthy();
      expect(getMd(editor)).toBe(stored);
      editor.destroy();
    });
  }

  it("anchors a new equation by its node attribute", () => {
    const editor = makeEditor(`Intro.\n\n${BLOCK}`);
    const { pos, node } = find(editor, "mathBlock");
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, anchorId: "3" }),
    );
    expect(getMd(editor)).toBe(`Intro.\n\n<!-- fmc:3 -->\n${BLOCK}\n<!-- /fmc:3 -->`);
    editor.destroy();
  });

  it("writes an equation in a list item with the item's indent on every line", () => {
    const stored = "1. Item:\n\n   <!-- fmc:2 -->\n   $$\n   x\n   $$\n   <!-- /fmc:2 -->";
    const editor = makeEditor(stored);
    expect(find(editor, "mathBlock").node.attrs.anchorId).toBe("2");
    expect(getMd(editor)).toBe(stored);
    editor.destroy();
  });

  it("is one block to the splitter, markers and all", () => {
    const body = `One.\n\n<!-- fmc:1 -->\n${BLOCK}\n<!-- /fmc:1 -->\n\nTwo.`;
    expect(splitBlocks(body).blocks.map((b) => [b.text, b.kind])).toEqual([
      ["One.", "markdown"],
      [`<!-- fmc:1 -->\n${BLOCK}\n<!-- /fmc:1 -->`, "markdown"],
      ["Two.", "markdown"],
    ]);
  });

  it("matches its recorded TeX as anchor text", () => {
    expect(anchorTextMatches("E = mc^2", `\n${BLOCK}\n`)).toBe(true);
  });
});

describe("inline equations", () => {
  it("reads as its TeX between dollars", () => {
    const editor = makeEditor("Energy $E = mc^2$ here.");
    const size = editor.state.doc.content.size;
    expect(plainText(editor.state.doc, 0, size)).toBe("Energy $E = mc^2$ here.");
    editor.destroy();
  });

  it("anchors a selected equation between edges", () => {
    const editor = makeEditor("Energy $E = mc^2$ here.");
    const { pos, node } = find(editor, "mathInline");
    editor.view.dispatch(anchorEdgesTransaction(editor.state, pos, pos + node.nodeSize, 5));
    expect(getMd(editor)).toBe("Energy <!-- fmc:5 -->$E = mc^2$<!-- /fmc:5 --> here.");
    editor.destroy();
  });

  it("is classified as inline text, not rejected", () => {
    const editor = makeEditor("Energy $E = mc^2$ here.");
    const { pos, node } = find(editor, "mathInline");
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    expect(classifyCodeSelection(editor.state.doc, pos, pos + node.nodeSize).kind).toBe("inline");
    editor.destroy();
  });

  it("keeps TeX underscores and stars when matching anchor text", () => {
    expect(anchorTextMatches("$a_1 * b_2$", "$a_1 * b_2$")).toBe(true);
    expect(anchorTextMatches("the $x_i$ term", "the $x_i$ term")).toBe(true);
  });
});

describe("Mermaid diagrams", () => {
  it("classifies a selected diagram as a whole-block anchor with its source", () => {
    const editor = makeEditor(`Intro.\n\n${MERMAID}`);
    const { pos, node } = find(editor, "mermaidBlock");
    const cls = classifyCodeSelection(editor.state.doc, pos, pos + node.nodeSize);
    expect(cls).toMatchObject({ kind: "block", pos, text: "graph TD\n  A --> B" });
    editor.destroy();
  });

  it("writes an anchored diagram back with markers around it", () => {
    const stored = `Intro.\n\n<!-- fmc:4 -->\n${MERMAID}\n<!-- /fmc:4 -->`;
    const editor = makeEditor(stored);
    expect(find(editor, "mermaidBlock").node.attrs.anchorId).toBe("4");
    expect(editor.view.dom.querySelector('.fm-mermaid[data-anchor-id="4"]')).toBeTruthy();
    expect(getMd(editor)).toBe(stored);
    editor.destroy();
  });

  it("anchors a new diagram, and the drawing picks up the id", () => {
    const editor = makeEditor(MERMAID);
    const { pos, node } = find(editor, "mermaidBlock");
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, anchorId: "2" }),
    );
    expect(editor.view.dom.querySelector('.fm-mermaid[data-anchor-id="2"]')).toBeTruthy();
    expect(getMd(editor)).toBe(`<!-- fmc:2 -->\n${MERMAID}\n<!-- /fmc:2 -->`);
    editor.destroy();
  });

  it("matches its recorded source as anchor text", () => {
    expect(anchorTextMatches("graph TD A --> B", `\n${MERMAID}\n`)).toBe(true);
  });
});

describe("any fenced block", () => {
  it("takes the id on a tilde fence", () => {
    expect(blockAnchorsToInfoString("<!-- fmc:1 -->\n~~~sh\nls\n~~~\n<!-- /fmc:1 -->")).toBe(
      "~~~sh fmc=1\nls\n~~~",
    );
  });

  it("leaves markers around two blocks alone", () => {
    const body = "<!-- fmc:1 -->\n```\na\n```\n```\nb\n```\n<!-- /fmc:1 -->";
    expect(blockAnchorsToInfoString(body)).toBe(body);
  });

  it("round-trips an anchored code block in a list item", () => {
    const stored = "- Item:\n\n  <!-- fmc:3 -->\n  ```js\n  x()\n  ```\n  <!-- /fmc:3 -->";
    const editor = makeEditor(stored);
    expect(find(editor, "codeBlock").node.attrs.anchorId).toBe("3");
    expect(getMd(editor)).toBe(stored);
    editor.destroy();
  });
});

describe("images", () => {
  it("read as their alt text, or their file name without one", () => {
    const editor = makeEditor("See ![a swatch](img/swatch.png) and ![](img/logo.png?v=2).");
    const size = editor.state.doc.content.size;
    expect(plainText(editor.state.doc, 0, size)).toBe("See a swatch and logo.png.");
    editor.destroy();
  });

  it("anchor between edges", () => {
    const editor = makeEditor("See ![](img/logo.png) here.");
    const { pos, node } = find(editor, "image");
    editor.view.dispatch(anchorEdgesTransaction(editor.state, pos, pos + node.nodeSize, 6));
    expect(getMd(editor)).toBe("See <!-- fmc:6 -->![](img/logo.png)<!-- /fmc:6 --> here.");
    editor.destroy();
  });

  it("match the recorded text", () => {
    expect(anchorTextMatches("logo.png", "![](img/logo.png)")).toBe(true);
    expect(anchorTextMatches("a swatch", "![a swatch](img/swatch.png)")).toBe(true);
    expect(anchorTextMatches("swatch.png", "![[img/swatch.png]]")).toBe(true);
  });
});
