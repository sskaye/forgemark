// Bug 1: <sub>/<sup> previously rendered as plain text (no schema mark)
// and were dropped on save. These tests drive a headless editor built the
// same way RenderedView builds it, and assert the marks parse into the
// schema and round-trip back to <sub>…</sub> / <sup>…</sup> on serialize.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Markdown } from "tiptap-markdown";

const SubscriptMark = Subscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sub>", close: "</sub>", expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});
const SuperscriptMark = Superscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sup>", close: "</sup>", expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      SubscriptMark,
      SuperscriptMark,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
      }),
    ],
    content: markdown,
  });
}

function roundTrip(markdown: string): { html: string; md: string } {
  const editor = makeEditor(markdown);
  const html = editor.getHTML();
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  const md = storage.markdown?.getMarkdown?.() ?? "";
  editor.destroy();
  return { html, md };
}

describe("subscript / superscript", () => {
  it("parses <sub> into a real sub element (not plain text)", () => {
    const { html } = roundTrip("H<sub>2</sub>O is water.");
    expect(html).toContain("<sub>2</sub>");
  });

  it("parses <sup> into a real sup element", () => {
    const { html } = roundTrip("E = mc<sup>2</sup> roughly.");
    expect(html).toContain("<sup>2</sup>");
  });

  it("round-trips <sub> back to markdown losslessly", () => {
    const { md } = roundTrip("H<sub>2</sub>O is water.");
    expect(md).toContain("<sub>2</sub>");
    expect(md.trim()).toBe("H<sub>2</sub>O is water.");
  });

  it("round-trips <sup> back to markdown losslessly", () => {
    const { md } = roundTrip("E = mc<sup>2</sup> roughly.");
    expect(md).toContain("<sup>2</sup>");
    expect(md.trim()).toBe("E = mc<sup>2</sup> roughly.");
  });

  it("leaves a literal tilde (approx) untouched — no strikethrough collision", () => {
    const { md } = roundTrip("It took ~12 minutes to run.");
    expect(md).toContain("~12 minutes");
    expect(md).not.toContain("<sub>");
  });
});
