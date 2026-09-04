import { describe, it, expect, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { createBlockSync } from "../../src/components/blockSync";
import { sanitizeHtml } from "../../src/services/sanitizeHtml";

// A raw HTML block is written back byte for byte (editor-blocks.test.ts);
// this is about what it shows meanwhile.

let editor: Editor;

function load(body: string) {
  const sync = createBlockSync();
  editor.commands.setContent(sync.load(body), { emitUpdate: false });
  return sync;
}

const markdown = () =>
  (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

beforeEach(() => {
  editor = new Editor({ extensions: renderedExtensions(), content: "" });
});

describe("a raw HTML block", () => {
  it("renders a centred, sized image", () => {
    const body = '<p align="center"><img src="https://x.y/a.png" width="200"></p>\n';
    load(body);
    const block = editor.view.dom.querySelector(".fm-html-block");
    expect(block?.querySelector('p[align="center"] img')?.getAttribute("width")).toBe("200");
    expect(markdown()).toBe(body.trimEnd());
  });

  it("renders a table and a details summary", () => {
    load(
      "<table><tr><th>a</th></tr><tr><td>1</td></tr></table>\n\n<details>\n<summary>More</summary>\n\nBody.\n\n</details>\n",
    );
    const dom = editor.view.dom;
    expect(dom.querySelector(".fm-html-block table td")?.textContent).toBe("1");
    expect(dom.querySelector(".fm-html-block details summary")?.textContent).toBe("More");
    // The closing tag on its own has nothing to show; it keeps the placeholder.
    expect(dom.querySelector(".fm-verbatim-source")?.textContent).toBe("</details>");
  });

  it("leaves scripts, frames, and handlers out of the page but in the file", () => {
    const body =
      '<div onclick="x()"><script>alert(1)</script><iframe src="https://e.com"></iframe>Text <a href="javascript:y()">l</a></div>\n';
    load(body);
    const block = editor.view.dom.querySelector(".fm-html-block");
    expect(block?.querySelector("script, iframe")).toBeNull();
    expect(block?.querySelector("div")?.hasAttribute("onclick")).toBe(false);
    expect(block?.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(block?.textContent).toBe("Text l");
    expect(markdown()).toBe(body.trimEnd());
  });

  it("keeps the placeholder for a comment and for a block that shows nothing", () => {
    load("<!-- editors: keep -->\n\n<script>x()</script>\n");
    const labels = Array.from(editor.view.dom.querySelectorAll(".fm-verbatim-label")).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["HTML comment", "HTML"]);
  });
});

describe("sanitizeHtml", () => {
  it("keeps ordinary markup and text", () => {
    const out = sanitizeHtml('<p class="c">Hi <b>there</b></p>', document);
    const div = document.createElement("div");
    div.appendChild(out);
    expect(div.innerHTML).toBe('<p class="c">Hi <b>there</b></p>');
  });
});
