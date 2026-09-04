import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration as PMDecoration, DecorationSet } from "@tiptap/pm/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { splitFrontmatter } from "../format";
import { createBlockSync, type BlockSync, type Serializer } from "./blockSync";
import { renderedExtensions } from "./editorExtensions";
import { anchorIdOf } from "../services/anchorDom";
import {
  ANCHOR_EDGE,
  anchorEdges,
  anchorEdgesTransaction,
  anchorRanges,
  plainText,
  setAnchorHighlight,
} from "./AnchorEdge";
import { normalizeExternalUrl } from "../services/externalLinks";
import { findLiteralMatches } from "../services/findReplace";
import {
  buildNormalizedIndex,
  findAnchorPosition,
  makeAnchorFromIndex,
  scrollPaneToRatio,
  scrollRatio,
  type ViewSyncAnchor,
} from "../services/viewSync";
import "./RenderedView.css";

// Captured selection metadata used by the new-comment composer. Phase 5.
export type CapturedSelection = {
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
  // How the selection should be anchored:
  //   - "inline": a normal inline anchor (may include inline code).
  //   - "block":  a whole fenced code block; from/to/text are expanded to
  //               the entire block.
  //   - "reject": can't be anchored (selection wholly inside inline code,
  //               or crossing a code-block boundary). rejectReason carries
  //               a user-facing message.
  selectionKind: "inline" | "block" | "reject";
  rejectReason?: string;
  // The id of the existing comment whose anchor this selection overlaps,
  // or null when the selection is free of any anchor. When set, the
  // new-comment flow offers a reply instead of writing an (unrepresentable)
  // overlapping marker pair. Ties broken toward the anchor that starts
  // earliest in the document.
  overlappingAnchorId: number | null;
  // Editor-local viewport coordinates. `left`/`bottom` describe the
  // selection's *end*, for floating the composer just below it; `top` is
  // the top of its *first* line, for floating the toolbar just above.
  rect: { left: number; top: number; bottom: number };
};

// tiptap-markdown's serializer, which takes a fragment.
function markdownSerializer(editor: { storage: unknown }): Serializer {
  return (editor.storage as { markdown: { serializer: Serializer } }).markdown.serializer;
}

export type RenderedViewHandle = {
  // Captures the current selection. Returns null when the selection is
  // empty / collapsed. The caller decides whether to open the composer.
  captureSelection(): CapturedSelection | null;
  // Apply a paired anchor marker pair to the given range and return the
  // updated body (with marker comments restored from the rendered span
  // wrappers). Used by the composer on submit.
  applyAnchor(from: number, to: number, id: number): string;
  selectedText(): string | null;
  search(query: string, matchCase: boolean, activeIndex: number): RenderedSearchMatch[];
  activateSearchMatch(matches: RenderedSearchMatch[], activeIndex: number): void;
  replaceSearchMatch(match: RenderedSearchMatch, replacement: string): boolean;
  replaceAllSearchMatches(matches: RenderedSearchMatch[], replacement: string): number;
  clearSearch(): void;
  captureViewportAnchor(pane: HTMLElement): ViewSyncAnchor | null;
  scrollToViewportAnchor(anchor: ViewSyncAnchor): boolean;
};

export type RenderedSearchMatch = {
  from: number;
  to: number;
  text: string;
};

type Props = {
  // Markdown body of the document. Marker comments (`<!-- fmc:N -->...
  // <!-- /fmc:N -->`) become AnchorEdge nodes in the editor, and the
  // passage between a pair is highlighted by a decoration carrying
  // `data-anchor-id`.
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
  onExternalLinkError?: (message: string) => void;
  onOpenExternalLink?: (url: string) => Promise<void> | void;
  // Phase 5 composer trigger handle. The parent attaches this and calls
  // `current.captureSelection()` from the ⌘⌥M shortcut handler.
  handleRef?: React.MutableRefObject<RenderedViewHandle | null>;
  // Fires as the reader selects and deselects, so the host can float a
  // Comment / Suggest edit affordance at the selection — the same
  // affordance an HTML report gets, so the two document kinds behave
  // alike. ProseMirror announces selection changes directly here, so
  // unlike the report frame this needs no polling.
  onSelectionChange?: (capture: CapturedSelection | null) => void;
};

// Phase 4 rendered view. Anchor edges are pre-rendered into the markdown
// body as `<fm-anchor>` elements before Tiptap ingests it;
// `tiptap-markdown` with `html: true` preserves them. Click + hover
// handlers on the editor's root DOM element delegate to the matching
// anchor by `data-anchor-id`, which the highlight decorations carry.
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
  onExternalLinkError,
  onOpenExternalLink = openUrl,
  handleRef,
  onSelectionChange,
}: Props) {
  // Front matter never reaches the editor: it would be read as a rule
  // and a heading, and come back rewritten. It is split off here and put
  // back on every edit, so the editor only ever sees the prose.
  const { front, rest } = useMemo(() => splitFrontmatter(body), [body]);
  const frontRef = useRef(front);
  frontRef.current = front;
  // One node per source block, and only edited blocks are ever
  // re-serialized (see blockSync.ts). The editor never rewrites the
  // document as a whole.
  const blockSyncRef = useRef<BlockSync | null>(null);
  if (!blockSyncRef.current) blockSyncRef.current = createBlockSync();
  const initialMarkdown = useMemo(() => blockSyncRef.current!.load(rest), [rest]);
  // Seeded with the same value handed to `content:` below, so the sync
  // effect correctly treats the mount as already-applied and skips a
  // redundant setContent.
  const lastInitialRef = useRef(initialMarkdown);

  // editorReadyRef gates onUpdate so initial mount + external loads
  // don't dispatch spurious edits. Declared before useEditor because
  // onCreate touches it during editor construction.
  //
  // It starts false and is flipped true in onCreate. It must NOT depend
  // on the sync effect below to flip it: that effect early-returns when
  // the content already matches, which is always true for an empty
  // Untitled buffer — leaving the gate shut forever, swallowing every
  // keystroke, so the document never went dirty and never auto-saved.
  const editorReadyRef = useRef(false);

  // useEditor captures its options once, so the live callback goes through
  // a ref rather than being closed over.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const editor = useEditor({
    extensions: renderedExtensions([SearchHighlightExtension]),
    content: initialMarkdown,
    editable: !readOnly,
    // The editor is constructed with the right content already, so it's
    // ready for user input immediately. Later content swaps re-close the
    // gate themselves in the sync effect below.
    onCreate: ({ editor }) => {
      blockSyncRef.current!.settle(editor.state.doc);
      editorReadyRef.current = true;
    },
    onSelectionUpdate: ({ editor }) => {
      onSelectionChangeRef.current?.(captureFrom(editor));
    },
    onBlur: () => {
      // Leaving the editor takes the affordance with it; the selection it
      // pointed at is no longer what the reader is acting on.
      onSelectionChangeRef.current?.(null);
    },
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
      // Only the blocks whose nodes changed are re-serialized (edge
      // nodes write their markers) and spliced into the source.
      // This is the single editor → state boundary.
      const restBody = blockSyncRef.current!.emit(editor.state.doc, markdownSerializer(editor));
      // Pre-emptively update the ref so the upcoming setContent
      // useEffect (triggered when the new state.body propagates back
      // as initialMarkdown) sees a match and skips the rewrite —
      // otherwise every keystroke would re-render the editor and
      // reset the cursor. The display form must be what `load` would
      // produce for this body, so it is computed the same way.
      lastInitialRef.current = createBlockSync().load(restBody);
      onEdit(frontRef.current + restBody);
    },
  });

  // When the body changes (file open / external reload / programmatic
  // edits like accept-suggestion), replace the doc. User keystrokes
  // skip this path because onUpdate updates lastInitialRef first.
  useEffect(() => {
    if (!editor) return;
    if (lastInitialRef.current === initialMarkdown) return;
    lastInitialRef.current = initialMarkdown;
    editorReadyRef.current = false;
    // Not an undo step. This path carries state-level changes — a comment
    // added, deleted, accepted, reattached, a reload from disk — and ⌘Z
    // reverting the *text* of one while the comment records stayed put
    // left the file with markers for a comment that no longer existed.
    // Undo is for typing; those changes have their own way back.
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(initialMarkdown, { emitUpdate: false })
      .run();
    blockSyncRef.current!.settle(editor.state.doc);
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

  // Click + hover delegation on links and anchor highlights. Links win over
  // comment-anchor focus: clicking an anchored link should open the link,
  // not just focus the comment card.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const findAnchor = anchorIdOf;
    const onClick = (e: Event) => {
      const link = findExternalLink(e.target);
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        const url = normalizeExternalUrl(link.getAttribute("href"));
        if (url) {
          void Promise.resolve(onOpenExternalLink(url)).catch((err: unknown) => {
            const detail = err instanceof Error ? err.message : String(err);
            onExternalLinkError?.(`Open link failed: ${detail}`);
          });
        }
        return;
      }
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
  }, [editor, onAnchorClick, onAnchorHover, onExternalLinkError, onOpenExternalLink]);

  // The focused and hovered comment light up their highlights. The
  // classes ride on the highlight decorations themselves: Tiptap owns
  // the DOM under the editor root and redraws a span whose attributes
  // were changed from outside.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setAnchorHighlight(editor.view, focusedCommentId, hoveredCommentId);
  }, [editor, focusedCommentId, hoveredCommentId]);

  // Phase 5: expose composer-supporting methods to the parent so the
  // EditorPane can capture the selection and insert the anchor's edges.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      captureSelection: () => captureFrom(editor),
      applyAnchor: (from: number, to: number, id: number) => {
        if (!editor) return body;
        // Whole code blocks carry the anchor as a node attribute (so it
        // round-trips as comment markers around the fence); everything else
        // gets an AnchorEdge node at each end. We don't need
        // `editable: true` for this — the view dispatches regardless.
        const cls = classifyCodeSelection(editor.state.doc, from, to);
        if (cls.kind === "block") {
          editor
            .chain()
            .setTextSelection({ from: cls.from, to: cls.to })
            .updateAttributes("codeBlock", { anchorId: String(id) })
            .run();
        } else {
          editor.view.dispatch(anchorEdgesTransaction(editor.state, from, to, id));
        }
        // Only the anchored block is re-serialized; the markers come out
        // of the edges (or the fence info string) on the way.
        const restBody = blockSyncRef.current!.emit(editor.state.doc, markdownSerializer(editor));
        lastInitialRef.current = createBlockSync().load(restBody);
        return frontRef.current + restBody;
      },
      selectedText: () => {
        if (!editor) return null;
        const { from, to, empty } = editor.state.selection;
        if (empty) return null;
        const text = plainText(editor.state.doc, from, to);
        return text.trim().length > 0 ? text : null;
      },
      search: (query: string, matchCase: boolean, activeIndex: number) => {
        if (!editor) return [];
        const matches = findDocumentMatches(editor.state.doc, query, matchCase);
        updateSearchDecorations(editor, matches, activeIndex);
        if (activeIndex >= 0) activateSearchMatch(editor, matches, activeIndex);
        return matches;
      },
      activateSearchMatch: (matches: RenderedSearchMatch[], activeIndex: number) => {
        if (!editor) return;
        updateSearchDecorations(editor, matches, activeIndex);
        activateSearchMatch(editor, matches, activeIndex);
      },
      // A match that straddles an anchor's edge is left alone: replacing
      // it would silently grow, shrink, or remove the anchor. Matches
      // wholly inside or wholly outside an anchor are fine.
      replaceSearchMatch: (match: RenderedSearchMatch, replacement: string) => {
        if (!editor || !editor.isEditable) return false;
        if (crossesAnchorEdge(editor.state.doc, match.from, match.to)) return false;
        const tr = editor.state.tr.insertText(replacement, match.from, match.to);
        editor.view.dispatch(tr);
        return true;
      },
      replaceAllSearchMatches: (matches: RenderedSearchMatch[], replacement: string) => {
        if (!editor || !editor.isEditable || matches.length === 0) return 0;
        const safe = matches.filter((m) => !crossesAnchorEdge(editor.state.doc, m.from, m.to));
        if (safe.length === 0) return 0;
        let tr = editor.state.tr;
        for (const match of [...safe].sort((a, b) => b.from - a.from)) {
          tr = tr.insertText(replacement, match.from, match.to);
        }
        editor.view.dispatch(tr);
        return safe.length;
      },
      clearSearch: () => {
        if (!editor) return;
        updateSearchDecorations(editor, [], -1);
      },
      captureViewportAnchor: (pane: HTMLElement) => {
        if (!editor) return null;
        const paneRect = pane.getBoundingClientRect();
        const rootRect = editor.view.dom.getBoundingClientRect();
        let sourcePosition: number | null = null;
        if (typeof document.elementFromPoint === "function") {
          try {
            sourcePosition =
              editor.view.posAtCoords({
                left: Math.max(rootRect.left + 8, paneRect.left + 24),
                top: paneRect.top + 40,
              })?.pos ?? null;
          } catch {
            sourcePosition = null;
          }
        }
        const index = buildRenderedViewportIndex(editor.state.doc);
        return makeAnchorFromIndex(index, sourcePosition, scrollRatio(pane));
      },
      scrollToViewportAnchor: (anchor: ViewSyncAnchor) => {
        if (!editor) return false;
        const pane = editor.view.dom.closest<HTMLElement>(".fm-editor-pane");
        if (!pane) return false;
        const index = buildRenderedViewportIndex(editor.state.doc);
        const pos = findAnchorPosition(index, anchor);
        if (pos == null) {
          scrollPaneToRatio(pane, anchor.ratio);
          return false;
        }
        queueMicrotask(() => {
          try {
            const coords = editor.view.coordsAtPos(pos);
            const paneRect = pane.getBoundingClientRect();
            pane.scrollTop += coords.top - paneRect.top - 40;
          } catch {
            scrollPaneToRatio(pane, anchor.ratio);
          }
        });
        return true;
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

// The current selection, as everything downstream needs it. Shared by the
// imperative handle (⌘⌥M, the context menu) and the selection watcher that
// floats the toolbar, so the two can never disagree about what is selected.
export function captureFrom(editor: ReturnType<typeof useEditor> | null): CapturedSelection | null {
  if (!editor) return null;
  const { state, view } = editor;
  const { from: selFrom, to: selTo, empty } = state.selection;
  if (empty) return null;

  const cls = classifyCodeSelection(state.doc, selFrom, selTo);
  // For a whole-block anchor, expand the range and text to cover the
  // entire code block (the comment is on the block, not a sub-span).
  const from = cls.kind === "block" ? cls.from : selFrom;
  const to = cls.kind === "block" ? cls.to : selTo;
  const text = cls.kind === "block" ? cls.text : plainText(state.doc, from, to);
  if (cls.kind !== "reject" && text.trim().length === 0) return null;

  // Overlap: inline anchors are found by their edges; a block that
  // already carries an anchorId is itself the overlap target.
  const overlappingAnchorId =
    cls.kind === "block" && cls.existingAnchorId != null
      ? cls.existingAnchorId
      : bestOverlappingAnchorId(state.doc, from, to);

  const beforeLen = Math.min(120, from);
  const afterLen = Math.min(120, state.doc.content.size - to);
  const contextBefore = plainText(state.doc, Math.max(0, from - beforeLen), from);
  const contextAfter = plainText(state.doc, to, Math.min(state.doc.content.size, to + afterLen));
  const rect = selectionRect(view, from, to);
  return {
    from,
    to,
    text,
    contextBefore,
    contextAfter,
    selectionKind: cls.kind,
    rejectReason: cls.kind === "reject" ? cls.reason : undefined,
    overlappingAnchorId,
    rect,
  };
}

// Where the selection sits, for floating the composer and the toolbar.
//
// Purely cosmetic, and the only part of a capture that can fail: measuring
// requires a layout, and the selection watcher now runs on *every*
// selection change rather than only when someone asks to comment. A
// position we cannot measure must cost the affordance its placement, never
// the reader their comment.
function selectionRect(
  view: EditorView,
  from: number,
  to: number,
): { left: number; top: number; bottom: number } {
  try {
    const end = view.coordsAtPos(to);
    const start = view.coordsAtPos(from);
    return { left: end.left, top: start.top, bottom: end.bottom };
  } catch {
    return { left: 0, top: 0, bottom: 0 };
  }
}

function findExternalLink(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const link = target.closest("a[href]");
  return link instanceof HTMLElement && link.tagName === "A" ? link : null;
}

type SearchDecorationState = {
  matches: RenderedSearchMatch[];
  activeIndex: number;
};

const searchPluginKey = new PluginKey<SearchDecorationState>("forgemark-search");

const SearchHighlightExtension = Extension.create({
  name: "forgemarkSearchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchDecorationState>({
        key: searchPluginKey,
        state: {
          init: () => ({ matches: [], activeIndex: -1 }),
          apply: (tr, value) => {
            const meta = tr.getMeta(searchPluginKey) as SearchDecorationState | undefined;
            if (meta) return meta;
            if (tr.docChanged) return { matches: [], activeIndex: -1 };
            return value;
          },
        },
        props: {
          decorations(state) {
            const value = searchPluginKey.getState(state);
            if (!value || value.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              value.matches.map((match, index) =>
                PMDecoration.inline(match.from, match.to, {
                  class:
                    "fm-search-match" +
                    (index === value.activeIndex ? " fm-search-match-active" : ""),
                  "data-testid": index === value.activeIndex ? "fm-search-active" : undefined,
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

function updateSearchDecorations(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  matches: RenderedSearchMatch[],
  activeIndex: number,
) {
  editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, { matches, activeIndex }));
}

function activateSearchMatch(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  matches: RenderedSearchMatch[],
  activeIndex: number,
) {
  const match = matches[activeIndex];
  if (!match) return;
  editor.commands.setTextSelection({ from: match.from, to: match.to });
  queueMicrotask(() => {
    const active = editor.view.dom.querySelector<HTMLElement>(".fm-search-match-active");
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

function findDocumentMatches(
  doc: ProseMirrorNode,
  query: string,
  matchCase: boolean,
): RenderedSearchMatch[] {
  const index = buildTextIndex(doc);
  const textMatches = findLiteralMatches(index.text, query, matchCase);
  const matches: RenderedSearchMatch[] = [];
  for (const textMatch of textMatches) {
    const start = index.positions[textMatch.from];
    const endChar = index.positions[textMatch.to - 1];
    if (start == null || endChar == null) continue;
    const rangePositions = index.positions.slice(textMatch.from, textMatch.to);
    if (rangePositions.some((pos) => pos == null)) continue;
    matches.push({
      from: start,
      to: endChar + 1,
      text: index.text.slice(textMatch.from, textMatch.to),
    });
  }
  return matches;
}

function buildTextIndex(doc: ProseMirrorNode): { text: string; positions: Array<number | null> } {
  let text = "";
  const positions: Array<number | null> = [];
  let previousEnd: number | null = null;
  doc.descendants((node, pos) => {
    // An anchor edge sits between two runs of the same text; it is not
    // a break in it.
    if (node.type.name === ANCHOR_EDGE) {
      if (previousEnd === pos) previousEnd = pos + node.nodeSize;
      return false;
    }
    if (!node.isText || !node.text) return true;
    if (previousEnd != null && pos > previousEnd) {
      text += "\n";
      positions.push(null);
    }
    for (let i = 0; i < node.text.length; i++) {
      text += node.text[i];
      positions.push(pos + i);
    }
    previousEnd = pos + node.text.length;
    return false;
  });
  return { text, positions };
}

function buildRenderedViewportIndex(doc: ProseMirrorNode) {
  const index = buildTextIndex(doc);
  return buildNormalizedIndex(index.text, index.positions);
}

// Classify a selection for anchoring relative to code regions:
//   - "block":  the selection lies within a single fenced code block →
//               anchor the whole block (from/to/text expanded to it).
//               existingAnchorId is the block's current anchor, if any.
//   - "reject": the selection is wholly inside inline code, or it crosses
//               a code-block boundary / spans multiple blocks — neither can
//               be anchored cleanly. reason carries a user-facing message.
//   - "inline": anything else (including a mix of prose and inline code) →
//               a normal inline anchor.
export type CodeSelectionClass =
  | { kind: "inline" }
  | { kind: "block"; from: number; to: number; text: string; existingAnchorId: number | null }
  | { kind: "reject"; reason: string };

export function classifyCodeSelection(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): CodeSelectionClass {
  const blocks: { start: number; end: number; node: ProseMirrorNode }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "codeBlock") {
      blocks.push({ start: pos, end: pos + node.nodeSize, node });
      return false; // don't descend into the code text
    }
    return true;
  });

  if (blocks.length > 1) {
    return {
      kind: "reject",
      reason: "Select within a single code block, or outside it, to comment.",
    };
  }
  if (blocks.length === 1) {
    const b = blocks[0];
    // The whole selection must sit within this block to anchor it cleanly;
    // a selection that starts in prose and runs into the fence can't.
    if (from >= b.start && to <= b.end) {
      const rawId = b.node.attrs.anchorId;
      const id = rawId == null ? null : Number(rawId);
      return {
        kind: "block",
        from: b.start + 1,
        to: b.end - 1,
        // textContent can carry a trailing newline; drop it so anchor_text
        // is the clean code text.
        text: b.node.textContent.replace(/\n$/, ""),
        existingAnchorId: id != null && Number.isFinite(id) ? id : null,
      };
    }
    return {
      kind: "reject",
      reason: "Select within a single code block, or outside it, to comment.",
    };
  }

  // No code block — but the selection may be inside inline code. We allow a
  // mix of prose and inline code (markers sit outside the backticks), and
  // only refuse a selection that is *entirely* inline code.
  let hasText = false;
  let allInlineCode = true;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.text && node.text.length > 0) {
      hasText = true;
      if (!node.marks.some((m) => m.type.name === "code")) allInlineCode = false;
    }
    return true;
  });
  if (hasText && allInlineCode) {
    return {
      kind: "reject",
      reason: "Comments can't be added inside inline code. Select the surrounding text too.",
    };
  }
  return { kind: "inline" };
}

// Find the existing anchor (comment id) whose highlighted span overlaps
// the given range [from, to). When several overlap, the one sharing the
// most characters wins; ties go to the anchor that starts earliest in the
// document. Returns null when the range touches no anchor.
//
// Exported for unit testing — the file format cannot represent overlapping
// or nested anchors, so this is the gate that diverts an overlapping
// new-comment into a reply (see OverlapPrompt).
// Whether [from, to) holds an anchor's edge — part of the range inside
// the anchor and part outside, or parts of two anchors. Replacing such a
// range would delete the edge.
export function crossesAnchorEdge(doc: ProseMirrorNode, from: number, to: number): boolean {
  return anchorEdges(doc).some((e) => e.pos >= from && e.pos < to);
}

export function bestOverlappingAnchorId(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): number | null {
  let best: number | null = null;
  let bestLen = 0;
  let bestFrom = Infinity;
  for (const r of anchorRanges(doc)) {
    const len = Math.min(to, r.to) - Math.max(from, r.from);
    if (len <= 0) continue;
    if (len > bestLen || (len === bestLen && r.from < bestFrom)) {
      best = r.id;
      bestLen = len;
      bestFrom = r.from;
    }
  }
  return best;
}
