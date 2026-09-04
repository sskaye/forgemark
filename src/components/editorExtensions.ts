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
//   - `AlertBlockquote`, `FootnoteRef`/`FootnoteDef`, and
//     `MarkdownTable` for what GitHub renders beyond the spec
//     (src/format/markdownExtras.ts teaches markdown-it the syntax).

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
import { Extension, type AnyExtension } from "@tiptap/core";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { markdownExtras } from "../format/markdownExtras";
import { AlertBlockquote } from "./AlertBlockquote";
import { FootnoteDef, FootnoteRef } from "./Footnotes";
import { MarkdownTable } from "./MarkdownTable";
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

export function renderedExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    // StarterKit ships its own Link, Code, and CodeBlock; each is
    // replaced by a configured variant below.
    StarterKit.configure({ link: false, codeBlock: false, code: false, blockquote: false }),
    CodeBlockAnchor,
    AlertBlockquote,
    MarkdownLink.configure({ openOnClick: false, autolink: false }),
    MarkdownSyntax,
    FootnoteRef,
    FootnoteDef,
    SubscriptMark,
    SuperscriptMark,
    AnchorEdge,
    HtmlMark,
    CodeInAnchor,
    VerbatimBlock,
    HtmlInline,
    ...extra,
    InlineImage,
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
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
