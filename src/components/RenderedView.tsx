import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import "./RenderedView.css";

type Props = {
  // Initial markdown to render. Changes only on file open — Tiptap owns the
  // doc state after that.
  initialMarkdown: string;
  // Fires after the user types anything that mutates the doc. Markdown is
  // the serialized form via tiptap-markdown.
  onEdit: (markdown: string) => void;
  readOnly?: boolean;
};

// Phase 2 rendered view. Tiptap with the GFM extensions we need today
// (headings, lists, code blocks, links, images, tables, task lists).
// Footnotes are deferred — most prose docs don't use them and the
// extension is non-trivial; revisit when a fixture demands it.
//
// The `tiptap-markdown` extension converts to/from markdown text. Phase 3
// replaces this with the byte-deterministic parser/serializer that handles
// the comments block — for now we accept tiptap-markdown's normalization.
// The "no-edits = byte-identical save" guarantee comes from the document
// state, which keeps the original bytes and only serializes if dirty.
export function RenderedView({ initialMarkdown, onEdit, readOnly }: Props) {
  const lastInitialRef = useRef(initialMarkdown);

  const editor = useEditor({
    extensions: [
      // Disable StarterKit's built-in Link so we can use the standalone
      // extension with our own configuration (openOnClick disabled — clicks
      // are passed through to the host so Tauri can handle them later).
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: initialMarkdown,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "fm-prose",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => {
      // tiptap-markdown stores its serializer on editor.storage.markdown.
      // The type isn't published, so we narrow through `unknown`.
      const storage = editor.storage as unknown as {
        markdown?: { getMarkdown?: () => string };
      };
      const md = storage.markdown?.getMarkdown?.() ?? "";
      onEdit(md);
    },
  });

  // When a different file is opened, replace the doc content — Tiptap
  // doesn't react to prop changes on its own.
  useEffect(() => {
    if (!editor) return;
    if (lastInitialRef.current === initialMarkdown) return;
    lastInitialRef.current = initialMarkdown;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
  }, [editor, initialMarkdown]);

  // Read-only flag may change separately (file became read-only externally).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <EditorContent editor={editor} className="fm-rendered-view" data-testid="fm-rendered-view" />
  );
}
