// The rendered editor's extension list, in one place so the editor, the
// print view, and the round-trip parity test all run the same pipeline.
//
// Three settings here exist because of what the round trip did to files:
//
//   - `autolink: false`, and linkify under GitHub's rule (a scheme or
//     `www.`, never a bare domain). With the defaults, "SKILL.md" in
//     prose came back as a link to http://SKILL.md (the `.md` TLD), and
//     so did every e-mail address. A linked address is written back
//     bare, not as `<…>` or `[…](…)`.
//   - Code with `excludes: ""`. Tiptap's Code mark excludes every other
//     mark, so bold was dropped from inline code at parse time and
//     `**bold `code`**` came back as `**bold** `code` ****`.
//   - `CodeBlockAnchor` in place of the stock code block, which keeps a
//     whole-block anchor on the node across the round trip; `AnchorEdge`
//     for inline anchors, whose edges are nodes so they serialize where
//     they sit.
//   - `HtmlMark` and `HtmlInline` for inline HTML the schema has no
//     element for, so a <kbd> or a comment survives an edit of its
//     paragraph; `InlineImage` so an image can sit in a sentence or a
//     link and keep its width.
//   - `AlertBlockquote`, `FootnoteRef`/`FootnoteDef`, `MarkdownTable`,
//     `MathInline`/`MathBlock`, and `MermaidBlock` for what GitHub
//     renders beyond the spec (src/format/markdownExtras.ts teaches
//     markdown-it the syntax).

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Code from "@tiptap/extension-code";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import Text from "@tiptap/extension-text";
import { Extension, type AnyExtension } from "@tiptap/core";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { markdownExtras } from "../format/markdownExtras";
import { AlertBlockquote } from "./AlertBlockquote";
import { FootnoteDef, FootnoteRef } from "./Footnotes";
import { MarkdownTable } from "./MarkdownTable";
import { MathBlock, MathInline } from "./Math";
import { MermaidBlock } from "./Mermaid";
import { WikiLink } from "./WikiLink";
import { AssetPaths } from "./AssetPaths";
import { HeadingIds } from "./HeadingIds";
import { AnchorEdge } from "./AnchorEdge";
import { CodeBlockAnchor } from "./CodeBlockAnchor";
import { VerbatimBlock } from "./VerbatimBlock";
import { HtmlMark } from "./HtmlMark";
import { HtmlInline } from "./HtmlInline";
import { InlineImage } from "./InlineImage";

// Subscript / superscript with an explicit markdown serialize spec so
// `<sub>`/`<sup>` round-trip instead of flattening to plain text.
const SubscriptMark = Subscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "<sub>",
          close: "</sub>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

const SuperscriptMark = Superscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "<sup>",
          close: "</sup>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

const CodeInAnchor = Code.extend({ excludes: "" });

// A link whose text is its address is written bare; anything else as
// `[text](href "title")`. prosemirror-markdown writes the first as
// `<href>`, which GitHub does not read for a `www.` address.
interface LinkState {
  inAutolink?: boolean;
}
const isBareLink = (mark: PMMark, parent: PMNode, index: number) => {
  if (mark.attrs.title) return false;
  const href = String(mark.attrs.href ?? "");
  const content = parent.child(index);
  if (!content.isText || !content.text) return false;
  if (content.marks[content.marks.length - 1] !== mark) return false;
  if (index < parent.childCount - 1 && mark.isInSet(parent.child(index + 1).marks)) return false;
  const text = content.text;
  return href === text || href === "http://" + text || href === "mailto:" + text;
};
const MarkdownLink = Link.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(state: LinkState, mark: PMMark, parent: PMNode, index: number) {
            state.inAutolink = isBareLink(mark, parent, index);
            return state.inAutolink ? "" : "[";
          },
          close(state: LinkState, mark: PMMark) {
            const bare = state.inAutolink;
            state.inAutolink = undefined;
            if (bare) return "";
            const href = String(mark.attrs.href ?? "").replace(/[()"]/g, "\\$&");
            const title = mark.attrs.title
              ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
              : "";
            return `](${href}${title})`;
          },
          mixable: true,
        },
        parse: {},
      },
    };
  },
});

// Text, with `$` escaped alongside the characters prosemirror-markdown
// escapes, so a dollar in prose cannot pair with a later one and turn
// into math once the paragraph is rewritten.
interface TextState {
  inAutolink?: boolean;
  write(): void;
  atBlank(): boolean;
  esc(text: string, startOfLine?: boolean): string;
  text(text: string, escape?: boolean): void;
}
const MarkdownText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TextState, node: { text?: string }) {
          const text = node.text ?? "";
          if (state.inAutolink) {
            state.text(text, false);
            return;
          }
          const lines = text.split("\n");
          lines.forEach((line, i) => {
            state.write();
            state.text(state.esc(line, state.atBlank()).replace(/\$/g, "\\$"), false);
            if (i < lines.length - 1) state.text("\n", false);
          });
        },
        parse: {},
      },
    };
  },
});

// A task list that remembers whether it was tight. tiptap-markdown gives
// bullet lists a `tight` attribute its serializer honours; the task list
// had none, so every task list came back loose, with a blank line
// between items.
const MarkdownTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-tight") === "true" || !element.querySelector("p"),
        renderHTML: (attributes: { tight: boolean }) =>
          attributes.tight ? { "data-tight": "true" } : {},
      },
    };
  },
});

// Teaches the parser the syntax the extensions above render.
const MarkdownSyntax = Extension.create({
  name: "markdownSyntax",
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: Parameters<typeof markdownExtras>[0]) {
            markdownExtras(markdownit, { linkify: true });
          },
        },
      },
    };
  },
});

export interface RenderedOptions {
  // The folder the document is in, for images written relative to it.
  baseDir?: string | null;
}

export function renderedExtensions(
  extra: AnyExtension[] = [],
  options: RenderedOptions = {},
): AnyExtension[] {
  return [
    AssetPaths.configure({ baseDir: options.baseDir ?? null }),
    HeadingIds,
    // StarterKit ships its own Link, Code, and CodeBlock; each is
    // replaced by a configured variant below.
    StarterKit.configure({
      link: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      text: false,
    }),
    MarkdownText,
    CodeBlockAnchor,
    AlertBlockquote,
    MarkdownLink.configure({ openOnClick: false, autolink: false }),
    MarkdownSyntax,
    FootnoteRef,
    FootnoteDef,
    MathInline,
    MathBlock,
    MermaidBlock,
    WikiLink,
    SubscriptMark,
    SuperscriptMark,
    AnchorEdge,
    HtmlMark,
    CodeInAnchor,
    VerbatimBlock,
    HtmlInline,
    ...extra,
    InlineImage,
    // The wrapper is what scrolls a wide table sideways.
    MarkdownTable.configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableHeader,
    TableCell,
    MarkdownTaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({
      // html: true is what lets the `<fm-anchor>` edge elements we inject
      // survive the markdown→ProseMirror round-trip. Markdown bodies
      // we receive are from our own format layer; arbitrary user-typed
      // HTML still flows through, which is acceptable inside the local
      // Tauri webview.
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}
