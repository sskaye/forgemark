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
import { bodyFromAnchorSpans, bodyWithAnchorSpans } from "../format";
import { AnchorMark } from "./AnchorMark";
import "./RenderedView.css";

// Captured selection metadata used by the new-comment composer. Phase 5.
export type CapturedSelection = {
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
  insideCode: boolean;
  // Editor-local viewport coordinates of the selection's *end* — handy
  // for positioning the composer just below the highlighted text.
  rect: { left: number; bottom: number };
};

export type RenderedViewHandle = {
  // Captures the current selection. Returns null when the selection is
  // empty / collapsed. The caller decides whether to open the composer.
  captureSelection(): CapturedSelection | null;
  // Apply a paired anchor marker pair to the given range and return the
  // updated body (with marker comments restored from the rendered span
  // wrappers). Used by the composer on submit.
  applyAnchor(from: number, to: number, id: number): string;
};

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
  // Phase 5 composer trigger handle. The parent attaches this and calls
  // `current.captureSelection()` from the ⌘⌥M shortcut handler.
  handleRef?: React.MutableRefObject<RenderedViewHandle | null>;
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
  handleRef,
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
      // Skip until the parent has settled — initial mount and any
      // subsequent external load reset the doc via setContent, and
      // some of those transitions fire onUpdate even with
      // `emitUpdate: false`. Without this gate, the editor would
      // dispatch an "edit" with stale content and clobber state.body.
      if (!editorReadyRef.current) return;
      const storage = editor.storage as unknown as {
        markdown?: { getMarkdown?: () => string };
      };
      const md = storage.markdown?.getMarkdown?.() ?? "";
      // Convert any anchor `<span data-anchor-id>` wrappers back to
      // the canonical marker comments so the document state's body
      // always holds the format-layer source of truth. This is the
      // single editor → state boundary; the inverse
      // `bodyWithAnchorSpans` is applied on the way back in.
      const newBody = bodyFromAnchorSpans(md);
      // Pre-emptively update the ref so the upcoming setContent
      // useEffect (triggered when the new state.body propagates back
      // as initialMarkdown) sees a match and skips the rewrite —
      // otherwise every keystroke would re-render the editor and
      // reset the cursor.
      lastInitialRef.current = bodyWithAnchorSpans(newBody);
      onEdit(newBody);
    },
  });

  // editorReadyRef gates onUpdate so initial mount + external loads
  // don't dispatch spurious edits. Reset on every initialMarkdown
  // change (including external reloads), set after the post-
  // setContent paint via a microtask.
  const editorReadyRef = useRef(false);

  // When the body changes (file open / external reload / programmatic
  // edits like accept-suggestion), replace the doc. User keystrokes
  // skip this path because onUpdate updates lastInitialRef first.
  useEffect(() => {
    if (!editor) return;
    if (lastInitialRef.current === initialMarkdown) return;
    lastInitialRef.current = initialMarkdown;
    editorReadyRef.current = false;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
    // Defer the ready flip past the current task so any synchronous
    // setContent-induced onUpdate firings still see ready=false.
    queueMicrotask(() => {
      editorReadyRef.current = true;
    });
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

  // Phase 5: expose composer-supporting methods to the parent so the
  // EditorPane can capture the selection and apply the anchor mark.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      captureSelection: () => {
        if (!editor) return null;
        const { state, view } = editor;
        const { from, to, empty } = state.selection;
        if (empty) return null;
        const text = state.doc.textBetween(from, to, " ", " ");
        if (text.trim().length === 0) return null;
        const insideCode = isSelectionInsideCode(editor);
        const beforeLen = Math.min(120, from);
        const afterLen = Math.min(120, state.doc.content.size - to);
        const contextBefore = state.doc.textBetween(Math.max(0, from - beforeLen), from, " ", " ");
        const contextAfter = state.doc.textBetween(
          to,
          Math.min(state.doc.content.size, to + afterLen),
          " ",
          " ",
        );
        const coords = view.coordsAtPos(to);
        return {
          from,
          to,
          text,
          contextBefore,
          contextAfter,
          insideCode,
          rect: { left: coords.left, bottom: coords.bottom },
        };
      },
      applyAnchor: (from: number, to: number, id: number) => {
        if (!editor) return body;
        // Apply the AnchorMark to the captured range. We don't need the
        // editor to be `editable: true` for chained commands — Tiptap
        // runs them via dispatchTransaction directly.
        editor
          .chain()
          .setTextSelection({ from, to })
          .setMark("anchor", { anchorId: String(id) })
          .run();
        const storage = editor.storage as unknown as {
          markdown?: { getMarkdown?: () => string };
        };
        const md = storage.markdown?.getMarkdown?.() ?? "";
        // Tiptap-markdown emits `<span data-anchor-id="N">…</span>` for
        // the AnchorMark. Convert back to canonical marker comments.
        return bodyFromAnchorSpans(md);
      },
    };
    return () => {
      if (handleRef.current) handleRef.current = null;
    };
  }, [editor, handleRef, body]);

  return (
    <EditorContent editor={editor} className="fm-rendered-view" data-testid="fm-rendered-view" />
  );
}

// Walk the ProseMirror selection's nearest enclosing nodes to detect
// whether it lives inside a code block or an inline code mark. Used by
// the composer trigger to refuse comments inside code regions (mirrors
// the parser-level rule from Phase 3).
function isSelectionInsideCode(editor: NonNullable<ReturnType<typeof useEditor>>): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  let inside = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "codeBlock") inside = true;
    // Inline code is a Mark applied to text nodes.
    if (node.isText && node.marks.some((m) => m.type.name === "code")) {
      inside = true;
    }
    return !inside; // stop descending once we know
  });
  return inside;
}
