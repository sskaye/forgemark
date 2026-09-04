import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import { renderedExtensions } from "../../src/components/editorExtensions";
import { bodyWithAnchorElements, coalesceAnchorMarkers, splitFrontmatter } from "../../src/format";

// What the rendered editor does to a Markdown block on the way through.
//
// A save no longer writes the editor's whole-document serialization:
// only edited blocks are re-serialized and spliced (blockSync.ts, with
// its own tests). What remains at stake here is the *edited* block. The
// first list is what the editor round-trips exactly; the second is what
// it still normalizes when that particular block is edited — each marked
// `it.fails`, so when one starts surviving the test says so.

const FIXTURES = resolve(__dirname, "..", "ai", "fixtures");

function roundTrip(body: string, editor: Editor): string {
  const { front, rest } = splitFrontmatter(body);
  editor.commands.setContent(bodyWithAnchorElements(rest), { emitUpdate: false });
  const md = (
    editor.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();
  return front + coalesceAnchorMarkers(md);
}

// The editor drops trailing newlines; compare without them.
const trimEnd = (s: string) => s.replace(/\n+$/, "");

const editor = new Editor({ extensions: renderedExtensions(), content: "" });

describe("editor round trip: must be byte-identical", () => {
  const cases: Record<string, string> = {
    "front matter": "---\nname: x\ndescription: y\n---\n\n# Title\n\nBody.\n",
    "bare filename and address": "See SKILL.md and www.example.com for more.\n",
    "bold around inline code": "- **Keep every `<!-- fmc:N -->` pair.** Yes.\n",
    "anchor around inline code":
      "Call <!-- fmc:1 -->`foo()`<!-- /fmc:1 --> here and <!-- fmc:2 -->call `bar()`<!-- /fmc:2 --> there.\n",
    "anchor across emphasis": "Text <!-- fmc:1 -->**bold** and *em*<!-- /fmc:1 --> end.\n",
    "anchor inside emphasis": "Text **bo<!-- fmc:1 -->ld and<!-- /fmc:1 --> more** end.\n",
    "anchor around a link": "See <!-- fmc:1 -->[the docs](https://x.y) now<!-- /fmc:1 -->.\n",
    "anchor spanning two paragraphs": "One <!-- fmc:1 -->two.\n\nThree<!-- /fmc:1 --> four.\n",
    "inline HTML tags":
      'Press <kbd>Ctrl</kbd>, <mark>hi</mark>, <ins>in</ins>, <abbr title="x">ab</abbr>, <span style="color:red">r</span>.\n',
    "inline HTML the editor cannot hold":
      'Line <!-- note --> and a<wbr>b and <video src="a.mp4" controls></video> done.\n',
    "linked image": "[![badge](https://img.shields.io/x.svg)](https://x.y)\n",
    alert: "> [!NOTE]\n> Useful information.\n",
    footnotes: "Claim[^1].\n\n[^1]: The note.\n",
    "bare addresses": "Visit www.example.com or https://x.y/a_b?c=1 or foo@bar.com.\n",
    "escaped pipe in a table": "| a |\n| --- |\n| x \\| y |\n",
    "sized image in a sentence": 'Icon <img src="a.png" alt="A" width="20"> here.\n',
    "markers quoted inside a fence":
      "Example:\n\n```\nSome <!-- fmc:1 -->anchored<!-- /fmc:1 --> text\n```\n",
    "nested fences": "````md\n```js\nx()\n```\n````\n",
    "code block in a list": "- item\n\n  ```js\n  x()\n  ```\n\n- next\n",
    "whole-block anchor": '<!-- fmc:3 -->\n```python\nprint("hi")\n```\n<!-- /fmc:3 -->\n',
    "plain constructs":
      "# H1\n\nA paragraph with *em* and **strong**.\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n\n![alt](a.png)\n",
  };
  for (const [name, body] of Object.entries(cases)) {
    it(name, () => {
      expect(trimEnd(roundTrip(body, editor))).toBe(trimEnd(body));
    });
  }

  for (const name of readdirSync(FIXTURES).filter((n) => n.endsWith(".md"))) {
    it(`fixture ${name}`, () => {
      const text = readFileSync(resolve(FIXTURES, name), "utf8");
      const body = text.slice(0, text.indexOf("\n<!-- forgemark-comments\n") + 1);
      expect(trimEnd(roundTrip(body, editor))).toBe(trimEnd(body));
    });
  }
});

describe("editor round trip: still normalized when that block is edited", () => {
  const cases: Record<string, string> = {
    "hard-wrapped paragraph": "A paragraph\nwrapped across\nlines.\n",
    "reference link": "See [the docs][d].\n\n[d]: https://x.y\n",
    "HTML block": '<div align="center">\n<img src="x.png">\n</div>\n\nText.\n',
    "HTML comment": "Text.\n\n<!-- a note to editors -->\n\nMore.\n",
    "setext heading": "Title\n=====\n\nText.\n",
    "star bullets": "* one\n* two\n",
    "table alignment": "| a | b |\n|:--|--:|\n| 1 | 2 |\n",
    "backslash escapes": "Not \\*emphasis\\* and 1\\. not a list\n",
    "indented code": "    indented code\n\nafter\n",
  };
  for (const [name, body] of Object.entries(cases)) {
    it.fails(name, () => {
      expect(trimEnd(roundTrip(body, editor))).toBe(trimEnd(body));
    });
  }
});
