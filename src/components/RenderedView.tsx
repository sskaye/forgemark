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
import { useEffect, useMemo, useRef } from "react";
import { bodyWithAnchorSpans } from "../format";
import { AnchorMark } from "./AnchorMark";
import "./RenderedView.css";

type Props = {
  // Markdown body of the document. Marker comments (`<!-- fmc:N -->...
  // <!-- /fmc:N -->`) are pre-processed into `<span data-anchor-id="N">`
  // wrappers before being passed to Tiptap so the editor renders them as
  // styled inline highlights.
  body: string;
  // Fires after the user types anything that mutates the doc. Markdown is
  // the serialized form via tiptap-markdown.
  onEdit: (markdown: string) => void;
  readOnly?: boolean;
  // Phase 4 anchor / card synchronisation.
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  onAnchorClick: (id: number | null) => void;
  onAnchorHover: (id: number | null) => void;
};

// Phase 4 rendered view. Inline anchor spans are pre-rendered into the
// markdown body before Tiptap ingests it; `tiptap-markdown` with
// `html: true` preserves them. Click + hover handlers on the editor's
// root DOM element delegate to the matching anchor by `data-anchor-id`.
//
// The editor is configured editable=false when read-only is requested
// (or when the parent decides — Phase 4 keeps editing disabled when a
// file has comments because the round-trip-safe edit story lands in
// Phase 5).
export function RenderedView({
  body,
  onEdit,
  readOnly,
  focusedCommentId,
  hoveredCommentId,
  onAnchorClick,
  onAnchorHover,
}: Props) {
  const lastInitialRef = useRef("");
  const initialMarkdown = useMemo(() => bodyWithAnchorSpans(body), [body]);

  const editor = useEditor({
    extensions: [
      // StarterKit ships its own Link in v3; we use the standalone with
      // openOnClick disabled so clicks are the host's to handle.
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      AnchorMark,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        // html: true is what allows the anchor `<span>` wrappers we inject
        // to survive the markdown→ProseMirror round-trip. Markdown bodies
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
      const storage = editor.storage as unknown as {
        markdown?: { getMarkdown?: () => string };
      };
      const md = storage.markdown?.getMarkdown?.() ?? "";
      onEdit(md);
    },
  });

  // When the body changes (file open / external reload), replace the doc.
  useEffect(() => {
    if (!editor) return;
    if (lastInitialRef.current === initialMarkdown) return;
    lastInitialRef.current = initialMarkdown;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
  }, [editor, initialMarkdown]);

  // Read-only flag may change separately (file became read-only externally,
  // or comments are present and Phase 4 keeps editing off).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Click + hover delegation on anchor spans. Every span carries
  // `data-anchor-id`; we walk up from the event target to find the nearest
  // matching ancestor.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const findAnchor = (target: EventTarget | null): number | null => {
      if (!(target instanceof HTMLElement)) return null;
      const el = target.closest("[data-anchor-id]");
      if (!el || !(el instanceof HTMLElement)) return null;
      const raw = el.dataset.anchorId;
      const id = raw ? Number(raw) : NaN;
      return Number.isFinite(id) ? id : null;
    };
    const onClick = (e: Event) => {
      const id = findAnchor(e.target);
      if (id !== null) {
        onAnchorClick(id);
      } else {
        onAnchorClick(null);
      }
    };
    const onMouseOver = (e: Event) => {
      const id = findAnchor(e.target);
      if (id !== null) onAnchorHover(id);
    };
    const onMouseOut = (e: Event) => {
      const id = findAnchor(e.target);
      if (id !== null) onAnchorHover(null);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("mouseover", onMouseOver);
    root.addEventListener("mouseout", onMouseOut);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("mouseover", onMouseOver);
      root.removeEventListener("mouseout", onMouseOut);
    };
  }, [editor, onAnchorClick, onAnchorHover]);

  // Apply focus / hover classes onto matching anchor spans. We do this
  // imperatively because Tiptap owns the DOM under the editor root; the
  // alternative (reseting content on every focus change) would lose the
  // user's selection.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const all = root.querySelectorAll<HTMLElement>("[data-anchor-id]");
    all.forEach((el) => {
      const id = el.dataset.anchorId ? Number(el.dataset.anchorId) : null;
      el.classList.toggle("is-focused", id === focusedCommentId);
      el.classList.toggle("is-hovered", id === hoveredCommentId);
    });
  }, [editor, focusedCommentId, hoveredCommentId, body]);

  return (
    <EditorContent editor={editor} className="fm-rendered-view" data-testid="fm-rendered-view" />
  );
}
