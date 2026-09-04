// The rendered editor's extension list, in one place so the editor, the
// print view, and the round-trip parity test all run the same pipeline.
//
// Three settings here exist because of what the round trip did to files:
//
//   - `linkify: false` and `autolink: false`. With either on, a bare
//     "SKILL.md" in prose came back as a link to http://SKILL.md (the
//     `.md` TLD), and so did every www. and e-mail address.
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

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Code from "@tiptap/extension-code";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import type { AnyExtension } from "@tiptap/core";
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

export function renderedExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    // StarterKit ships its own Link, Code, and CodeBlock; each is
    // replaced by a configured variant below.
    StarterKit.configure({ link: false, codeBlock: false, code: false }),
    CodeBlockAnchor,
    Link.configure({ openOnClick: false, autolink: false }),
    SubscriptMark,
    SuperscriptMark,
    AnchorEdge,
    HtmlMark,
    CodeInAnchor,
    VerbatimBlock,
    HtmlInline,
    ...extra,
    InlineImage,
    Table.configure({ resizable: false }),
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
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}
