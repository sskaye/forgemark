import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration as PMDecoration, DecorationSet } from "@tiptap/pm/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bodyFromAnchorSpans, bodyWithAnchorSpans } from "../format";
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
import { createMarkdownExtensions } from "./markdownRendering";
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
  onExternalLinkError?: (message: string) => void;
  onOpenExternalLink?: (url: string) => Promise<void> | void;
  documentPath?: string | null;
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
  onExternalLinkError,
  onOpenExternalLink = openUrl,
  documentPath = null,
  handleRef,
}: Props) {
  const lastInitialRef = useRef("");
  const initialMarkdown = useMemo(() => bodyWithAnchorSpans(body), [body]);

  const editor = useEditor({
    extensions: createMarkdownExtensions({
      documentPath,
      extraExtensions: [SearchHighlightExtension],
    }),
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

  // Click + hover delegation on links and anchor spans. Links win over
  // comment-anchor focus: clicking an anchored link should open the link,
  // not just focus the comment card.
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
        const { from: selFrom, to: selTo, empty } = state.selection;
        if (empty) return null;

        const cls = classifyCodeSelection(state.doc, selFrom, selTo);
        // For a whole-block anchor, expand the range and text to cover the
        // entire code block (the comment is on the block, not a sub-span).
        const from = cls.kind === "block" ? cls.from : selFrom;
        const to = cls.kind === "block" ? cls.to : selTo;
        const text = cls.kind === "block" ? cls.text : state.doc.textBetween(from, to, " ", " ");
        if (cls.kind !== "reject" && text.trim().length === 0) return null;

        // Overlap: inline anchors are detected via the anchor mark; a block
        // that already carries an anchorId is itself the overlap target.
        const overlappingAnchorId =
          cls.kind === "block" && cls.existingAnchorId != null
            ? cls.existingAnchorId
            : bestOverlappingAnchorId(state.doc, from, to);

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
          selectionKind: cls.kind,
          rejectReason: cls.kind === "reject" ? cls.reason : undefined,
          overlappingAnchorId,
          rect: { left: coords.left, bottom: coords.bottom },
        };
      },
      applyAnchor: (from: number, to: number, id: number) => {
        if (!editor) return body;
        // Whole code blocks carry the anchor as a node attribute (so it
        // round-trips as comment markers around the fence); everything else
        // uses the inline AnchorMark. We don't need `editable: true` for
        // chained commands — Tiptap runs them via dispatchTransaction.
        const cls = classifyCodeSelection(editor.state.doc, from, to);
        if (cls.kind === "block") {
          editor
            .chain()
            .setTextSelection({ from: cls.from, to: cls.to })
            .updateAttributes("codeBlock", { anchorId: String(id) })
            .run();
        } else {
          editor
            .chain()
            .setTextSelection({ from, to })
            .setMark("anchor", { anchorId: String(id) })
            .run();
        }
        const storage = editor.storage as unknown as {
          markdown?: { getMarkdown?: () => string };
        };
        const md = storage.markdown?.getMarkdown?.() ?? "";
        // Inline anchors serialize as `<span data-anchor-id>`; convert back
        // to markers. Block anchors already serialize as markers.
        return bodyFromAnchorSpans(md);
      },
      selectedText: () => {
        if (!editor) return null;
        const { from, to, empty } = editor.state.selection;
        if (empty) return null;
        const text = editor.state.doc.textBetween(from, to, " ", " ");
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
      replaceSearchMatch: (match: RenderedSearchMatch, replacement: string) => {
        if (!editor || !editor.isEditable) return false;
        const tr = editor.state.tr.insertText(replacement, match.from, match.to);
        editor.view.dispatch(tr);
        return true;
      },
      replaceAllSearchMatches: (matches: RenderedSearchMatch[], replacement: string) => {
        if (!editor || !editor.isEditable || matches.length === 0) return 0;
        let tr = editor.state.tr;
        for (const match of [...matches].sort((a, b) => b.from - a.from)) {
          tr = tr.insertText(replacement, match.from, match.to);
        }
        editor.view.dispatch(tr);
        return matches.length;
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
export function bestOverlappingAnchorId(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): number | null {
  const overlap = new Map<number, { len: number; pos: number }>();
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === "anchor");
    if (!mark) return true;
    const id = Number(mark.attrs.anchorId);
    if (!Number.isFinite(id)) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const len = Math.max(0, end - start);
    if (len === 0) return true;
    const cur = overlap.get(id);
    if (cur) cur.len += len;
    else overlap.set(id, { len, pos: start });
    return true;
  });
  let best: number | null = null;
  let bestLen = 0;
  let bestPos = Infinity;
  for (const [id, { len, pos }] of overlap) {
    if (len > bestLen || (len === bestLen && pos < bestPos)) {
      best = id;
      bestLen = len;
      bestPos = pos;
    }
  }
  return best;
}
