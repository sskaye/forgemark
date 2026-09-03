import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../state/DocumentProvider";
import type { DocId } from "../state/workspace";
import { useAuthorName } from "../state/preferences";
import {
  RenderedView,
  type CapturedSelection,
  type RenderedSearchMatch,
  type RenderedViewHandle,
} from "./RenderedView";
import { HtmlView, type HtmlCapturedSelection, type HtmlViewHandle } from "./HtmlView";
import { SourceView, type SourceViewHandle } from "./SourceView";
import { NewCommentComposer } from "./NewCommentComposer";
import { SelectionToolbar } from "./SelectionToolbar";
import { OverlapPrompt } from "./OverlapPrompt";
import { FindReplaceBar } from "./FindReplaceBar";
import { LostAnchorBanner } from "./LostAnchorBanner";
import { ContextMenu } from "./ContextMenu";
import { commandFor, modalOpen } from "../state/keymap";
import {
  classifyAnchors,
  contextSnippet,
  insertMarkersIntoBody,
  nextCommentId,
  serializeForgemarkFile,
  locateAnchor,
  applyPlacement,
  type Placement,
} from "../format";
import type { ViewSyncAnchor } from "../services/viewSync";
import "./EditorPane.css";

// A candidate at or above this score is an exact match — the anchor text
// found verbatim, or an element resolved by the id the comment recorded.
// Below it, the ranking is guessing and a human should look.
const CONFIDENT_SCORE = 0.95;

// Normalise a Markdown capture into the shape the composer path takes.
// The only real difference is a whole code block, which is still a *text*
// anchor in Markdown — the markers wrap the fence and no `anchor_kind` is
// written — so it maps to "inline" rather than "element".
function fromMarkdownCapture(c: CapturedSelection): HtmlCapturedSelection {
  return {
    from: c.from,
    to: c.to,
    text: c.text,
    contextBefore: c.contextBefore,
    contextAfter: c.contextAfter,
    kind: "inline",
    rejectReason:
      c.selectionKind === "reject"
        ? (c.rejectReason ?? "This selection can't be commented on.")
        : undefined,
    overlappingAnchorId: c.overlappingAnchorId,
    rect: c.rect,
  };
}

type Props = {
  // Which open document this pane shows. Omitted means the active one,
  // which is how the pre-tabs callers (and several tests) use it.
  docId?: DocId;
};

// Editor pane. Switches between the rendered (Tiptap) view and the raw
// markdown source. The pane scrolls vertically; the document caps at
// 720px wide and centres inside the pane.
//
// Phase 5: hosts the new-comment composer. Selection is captured from
// the rendered view via a ref; on submit, the rendered view applies the
// anchor mark and returns the new body, which is dispatched along with
// the new Comment.
//
// Phase 8: source view is now CodeMirror-based with a "read-only review"
// chip overlay. Card-click focus changes scroll the source view to the
// matching marker via the SourceView imperative handle.
export function EditorPane({ docId }: Props) {
  const { workspace, dispatchTo } = useWorkspace();
  const id = docId ?? workspace.activeId;
  const state = workspace.docs[id];
  // Every open document keeps a mounted editor so its undo history,
  // cursor, and scroll survive a tab switch. Only one is on screen, and
  // only that one may own the window-level shortcuts.
  const isActive = id === workspace.activeId;

  const dispatch = useMemo(() => dispatchTo(id), [dispatchTo, id]);
  const setViewMode = useCallback(
    (viewMode: "rendered" | "source") => dispatch({ type: "setViewMode", viewMode }),
    [dispatch],
  );
  // Each pane classifies its own anchors. AppShell keeps a separate memo
  // for the sidebar and modals; that duplicates the work for the active
  // document only, and classifyAnchors is a pure pass over data already
  // in memory. Hoist into the workspace if it ever shows up in a profile.
  const anchorStatuses = useMemo(
    () => classifyAnchors(state.body, state.comments, state.format),
    [state.body, state.comments, state.format],
  );
  // HTML documents are review-only: the prose can't be edited, because
  // editing means modelling the document and any editor model destroys
  // the CSS, inline SVG, and unknown attributes a generated report is
  // made of. Commenting, replying, suggesting and accepting a suggestion
  // all still work — they are splices on the source, not edits through a
  // model. Find/replace is off for the same reason replace is: there is
  // nothing to type into.
  const isHtml = state.format === "html";
  const [author] = useAuthorName();
  const handleRef = useRef<RenderedViewHandle | null>(null);
  const htmlRef = useRef<HtmlViewHandle | null>(null);
  const sourceRef = useRef<SourceViewHandle | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const pendingViewSyncRef = useRef<ViewSyncAnchor | null>(null);
  // Hiding a pane with display:none drops its scrollTop, and reading it
  // during the switch races the DOM update — so track it continuously
  // while visible and put it back on the way in.
  const scrollTopRef = useRef(0);
  const [findState, setFindState] = useState({
    open: false,
    replaceVisible: false,
    query: "",
    replacement: "",
    matches: [] as RenderedSearchMatch[],
    activeIndex: -1,
  });
  // Right-click context menu state. Lives here (not in document
  // state) because it's strictly local to the editor pane and
  // shouldn't survive viewMode toggles or external state events.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // The live selection in an HTML report, as the toolbar's anchor. Held
  // here rather than in document state because it is a transient view
  // concern that must not survive a tab switch or a reload.
  const [selectionAffordance, setSelectionAffordance] = useState<HtmlCapturedSelection | null>(
    null,
  );
  const showAffordance = useCallback((capture: HtmlCapturedSelection | null) => {
    // A selection that can't be anchored gets no toolbar. The reason is
    // worth saying when someone acts on it, not as a button that refuses.
    setSelectionAffordance(capture?.rejectReason ? null : capture);
  }, []);

  // Composer trigger: ⌘⌥M (or the right-click menu) opens the
  // composer at the current selection. Selections inside fenced code
  // blocks or inline code spans are refused, mirroring the
  // parser-level rule from Phase 3. In Source view the trigger is a
  // no-op — Source is read-only review.
  // Open the composer for whatever the reader has selected. Both views
  // capture the same shape — a source range, the selected text, and the
  // surrounding context — so everything downstream of this point is
  // shared: the composer, the reducer action, and the YAML record.
  const openComposerFor = useCallback(
    (captured: HtmlCapturedSelection, initialMode: "comment" | "suggest" = "comment") => {
      if (captured.rejectReason) {
        dispatch({ type: "error", message: captured.rejectReason });
        return;
      }
      if (captured.overlappingAnchorId != null) {
        dispatch({
          type: "openComposer",
          composer: {
            mode: "overlapPrompt",
            targetCommentId: captured.overlappingAnchorId,
            x: captured.rect.left,
            y: captured.rect.bottom + 6,
          },
        });
        return;
      }
      dispatch({
        type: "openComposer",
        composer: {
          mode: "new",
          from: captured.from,
          to: captured.to,
          selectionText: captured.text,
          contextBefore: captured.contextBefore,
          contextAfter: captured.contextAfter,
          ...(captured.kind === "element" ? { anchorKind: "element" as const } : {}),
          ...(captured.anchorSelector ? { anchorSelector: captured.anchorSelector } : {}),
          x: captured.rect.left,
          y: captured.rect.bottom + 6,
          initialMode,
        },
      });
    },
    [dispatch],
  );

  const openComposer = useCallback(
    (initialMode: "comment" | "suggest" = "comment") => {
      if (state.viewMode !== "rendered") return;
      if (isHtml) {
        const captured = htmlRef.current?.captureSelection();
        if (!captured) return;
        openComposerFor(captured, initialMode);
        return;
      }
      const captured = handleRef.current?.captureSelection();
      if (!captured) return; // empty / collapsed selection
      openComposerFor(fromMarkdownCapture(captured), initialMode);
    },
    [isHtml, openComposerFor, state.viewMode],
  );

  const openFindReplace = useCallback(
    (replaceVisible: boolean) => {
      // Find is implemented over the editor's document model, which an
      // HTML report doesn't have. Rather than half-wire it, it stays off
      // here; Source view is searchable and is one keystroke away.
      if (isHtml) return;
      if (state.viewMode !== "rendered") {
        setViewMode("rendered");
      }
      const selected = handleRef.current?.selectedText()?.trim();
      setFindState((prev) => ({
        ...prev,
        open: true,
        replaceVisible: replaceVisible || prev.replaceVisible,
        query: selected && selected.length > 0 ? selected : prev.query,
        activeIndex: selected && selected.length > 0 ? 0 : prev.activeIndex,
      }));
    },
    [isHtml, setViewMode, state.viewMode],
  );

  const closeFindReplace = useCallback(() => {
    handleRef.current?.clearSearch();
    setFindState((prev) => ({ ...prev, open: false, matches: [], activeIndex: -1 }));
  }, []);

  const moveActiveMatch = useCallback((direction: 1 | -1) => {
    setFindState((prev) => {
      if (!prev.open || prev.matches.length === 0) return prev;
      const next =
        prev.activeIndex < 0
          ? direction > 0
            ? 0
            : prev.matches.length - 1
          : (prev.activeIndex + direction + prev.matches.length) % prev.matches.length;
      handleRef.current?.activateSearchMatch(prev.matches, next);
      return { ...prev, activeIndex: next };
    });
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const cmd = commandFor(e);
      if (!cmd || modalOpen()) return;
      switch (cmd) {
        case "comment":
          e.preventDefault();
          openComposer();
          return;
        case "suggest":
          e.preventDefault();
          openComposer("suggest");
          return;
        case "find-replace":
          e.preventDefault();
          openFindReplace(true);
          return;
        case "find":
          e.preventDefault();
          openFindReplace(false);
          return;
        case "find-next":
        case "find-prev":
          e.preventDefault();
          moveActiveMatch(cmd === "find-next" ? 1 : -1);
          return;
        case "find-selection": {
          e.preventDefault();
          const selected = handleRef.current?.selectedText()?.trim();
          if (!selected) return;
          if (state.viewMode !== "rendered") setViewMode("rendered");
          setFindState((prev) => ({
            ...prev,
            open: true,
            query: selected,
            activeIndex: 0,
          }));
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveActiveMatch, openComposer, openFindReplace, setViewMode, state.viewMode, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const onMenu = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "find-replace") openFindReplace(false);
    };
    window.addEventListener("forgemark:menu", onMenu);
    return () => window.removeEventListener("forgemark:menu", onMenu);
  }, [openFindReplace, isActive]);

  useEffect(() => {
    if (!findState.open) return;
    if (state.viewMode !== "rendered" || isHtml) return;
    const handle = handleRef.current;
    if (!handle) return;
    if (findState.query.length === 0) {
      handle.clearSearch();
      if (findState.matches.length > 0 || findState.activeIndex !== -1) {
        setFindState((prev) => ({ ...prev, matches: [], activeIndex: -1 }));
      }
      return;
    }
    const matches = handle.search(findState.query, false, -1);
    const activeIndex =
      matches.length === 0 ? -1 : Math.min(Math.max(findState.activeIndex, 0), matches.length - 1);
    if (activeIndex >= 0) handle.activateSearchMatch(matches, activeIndex);
    setFindState((prev) => {
      if (!prev.open) return prev;
      if (
        prev.activeIndex === activeIndex &&
        prev.matches.length === matches.length &&
        prev.matches.every((m, i) => m.from === matches[i]?.from && m.to === matches[i]?.to)
      ) {
        return prev;
      }
      return { ...prev, matches, activeIndex };
    });
  }, [
    findState.activeIndex,
    findState.matches,
    findState.open,
    findState.query,
    isHtml,
    state.body,
    state.viewMode,
  ]);

  // Right-click handling. Three regions:
  //   - inside a textarea / input: let the OS native menu show.
  //   - inside the rendered editor with a non-empty selection: show
  //     our custom menu (New Comment / Suggest Edit).
  //   - anywhere else (incl. rendered editor with no selection):
  //     suppress the default menu, show nothing.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow the OS menu inside form controls (composer textareas,
      // settings inputs).
      if (target.closest("textarea, input")) return;
      // Inside the rendered editor: show the custom menu when there
      // is a non-empty selection.
      const inRendered = target.closest(".fm-rendered-view");
      if (inRendered && state.viewMode === "rendered") {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
        return;
      }
      // Everywhere else (sidebar, modals outside textareas, banners,
      // title bar): suppress.
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, [state.viewMode]);

  // Both views expose `applyAnchor(from, to, id) -> new body`. For HTML
  // it is a byte splice into the source; for Markdown it runs through the
  // editor's mark system, which re-serializes the whole document in the
  // editor's dialect — the fallback, not the first choice (see below).
  const applyAnchor = useCallback(
    (from: number, to: number, id: number): string | null => {
      if (isHtml) return htmlRef.current?.applyAnchor(from, to, id) ?? null;
      return handleRef.current?.applyAnchor(from, to, id) ?? null;
    },
    [isHtml],
  );

  // The lossless way to anchor a Markdown comment: find the selected
  // passage in the untouched source and splice the two markers in. The
  // rest of the file is byte-identical afterwards, which is the promise
  // the format makes. The selection's surroundings disambiguate a phrase
  // that appears more than once. Returns null when the passage can't be
  // located exactly, and the editor path takes over.
  const spliceAnchor = useCallback(
    (
      c: { selectionText: string; contextBefore: string; contextAfter: string },
      id: number,
    ): { body: string; placement: Placement } | null => {
      if (isHtml) return null;
      try {
        const placement = locateAnchor(state.body, c.selectionText, "markdown", {
          near: { before: c.contextBefore, after: c.contextAfter },
        });
        return { body: applyPlacement(state.body, placement, id), placement };
      } catch {
        return null;
      }
    },
    [isHtml, state.body],
  );

  // Anchor metadata common to a new comment and a new suggestion.
  const anchorFields = useCallback(
    (c: {
      selectionText: string;
      contextBefore: string;
      contextAfter: string;
      anchorKind?: "element";
      anchorSelector?: string;
    }) => ({
      anchor_text: c.selectionText,
      ...(c.anchorKind ? { anchor_kind: c.anchorKind } : {}),
      ...(c.anchorSelector ? { anchor_selector: c.anchorSelector } : {}),
      context_before: c.contextBefore,
      context_after: c.contextAfter,
    }),
    [],
  );

  // The same fields, from a placement the locator made in the source.
  const placementFields = (p: Placement) => ({
    anchor_text: p.anchor_text,
    ...(p.anchor_kind ? { anchor_kind: p.anchor_kind } : {}),
    ...(p.anchor_selector ? { anchor_selector: p.anchor_selector } : {}),
    context_before: p.context_before,
    context_after: p.context_after,
  });

  const submitComment = useCallback(
    (commentBody: string) => {
      const c = state.composer;
      if (!c || c.mode !== "new") return;
      const id = nextCommentId(state.comments);
      const spliced = spliceAnchor(c, id);
      const newBody = spliced?.body ?? applyAnchor(c.from, c.to, id);
      if (newBody == null) return;
      dispatch({
        type: "addComment",
        body: newBody,
        comment: {
          id,
          ...(spliced ? placementFields(spliced.placement) : anchorFields(c)),
          author,
          timestamp: new Date().toISOString(),
          resolved: false,
          body: commentBody,
        },
      });
    },
    [state.composer, state.comments, author, dispatch, applyAnchor, spliceAnchor, anchorFields],
  );

  // Phase 7: suggested-edit submission. The composer captures both the
  // proposed replacement and an (optional) accompanying body. We apply
  // the same anchor mark as a regular new comment, then store the
  // Comment with `suggested_edit: { from, to }` and an optional body.
  const submitSuggestion = useCallback(
    (replacement: string, optionalBody: string) => {
      const c = state.composer;
      if (!c || c.mode !== "new") return;
      const id = nextCommentId(state.comments);
      const spliced = spliceAnchor(c, id);
      const newBody = spliced?.body ?? applyAnchor(c.from, c.to, id);
      if (newBody == null) return;
      // Accepting replaces the exact source between the markers, so
      // `from` is that source when we have it — the selection's rendered
      // text differs from it whenever the passage carries formatting.
      const from = spliced
        ? state.body.slice(spliced.placement.start, spliced.placement.end)
        : c.selectionText;
      dispatch({
        type: "addComment",
        body: newBody,
        comment: {
          id,
          ...(spliced ? placementFields(spliced.placement) : anchorFields(c)),
          author,
          timestamp: new Date().toISOString(),
          resolved: false,
          // body is optional for suggestions per the schema; only
          // include it when the user typed something.
          ...(optionalBody.length > 0 ? { body: optionalBody } : {}),
          suggested_edit: { from, to: replacement },
        },
      });
    },
    [
      state.composer,
      state.comments,
      state.body,
      author,
      dispatch,
      applyAnchor,
      spliceAnchor,
      anchorFields,
    ],
  );

  const cancelComposer = useCallback(() => dispatch({ type: "closeComposer" }), [dispatch]);

  // Overlap prompt → "Reply": focus the overlapped comment and open its
  // inline reply composer (the existing reply flow). This is how two
  // people comment on the same passage without overlapping anchors.
  const replyToOverlap = useCallback(() => {
    const c = state.composer;
    if (!c || c.mode !== "overlapPrompt") return;
    dispatch({ type: "setFocusedComment", id: c.targetCommentId });
    dispatch({ type: "openComposer", composer: { mode: "reply", commentId: c.targetCommentId } });
  }, [state.composer, dispatch]);

  const replaceActiveMatch = useCallback(() => {
    const match = findState.matches[findState.activeIndex];
    if (!match) return;
    if (handleRef.current?.replaceSearchMatch(match, findState.replacement)) {
      setFindState((prev) => ({ ...prev, activeIndex: Math.max(0, prev.activeIndex) }));
    }
  }, [findState.activeIndex, findState.matches, findState.replacement]);

  const replaceAllMatches = useCallback(() => {
    if (findState.matches.length === 0) return;
    const replaced = handleRef.current?.replaceAllSearchMatches(
      findState.matches,
      findState.replacement,
    );
    if (replaced) {
      setFindState((prev) => ({ ...prev, activeIndex: -1 }));
    }
  }, [findState.matches, findState.replacement]);

  // Phase 4 said the editor stays read-only when comments exist; Phase 5
  // keeps the same posture for free-form prose editing. Selection still
  // works in read-only Tiptap, which is what the composer needs.
  const editorReadOnly = state.readOnly;

  // Source view always shows the *current* serialized form (body +
  // trailing comments block) — not the bytes-as-loaded — so toggling
  // back and forth after edits reflects what would be written to disk.
  const sourceText = useMemo(
    () =>
      state.viewMode === "source"
        ? serializeForgemarkFile(
            { body: state.body, comments: state.comments },
            { validate: false },
          )
        : "",
    [state.viewMode, state.body, state.comments],
  );

  useEffect(() => {
    if (!isActive) return;
    const pane = paneRef.current;
    if (!pane) return;
    // After the pane is laid out again, not during the same frame.
    const frame = requestAnimationFrame(() => {
      pane.scrollTop = scrollTopRef.current;
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive]);

  useEffect(() => {
    // Global event with no document identity — without this gate every
    // mounted pane would capture on the active pane's view-mode toggle.
    if (!isActive) return;
    const onCapture = (e: Event) => {
      const detail = (e as CustomEvent<{ from: "rendered" | "source"; to: "rendered" | "source" }>)
        .detail;
      if (!detail || detail.from !== state.viewMode || detail.from === detail.to) return;
      const pane = paneRef.current;
      if (!pane) return;
      pendingViewSyncRef.current =
        state.viewMode === "rendered"
          ? (handleRef.current?.captureViewportAnchor(pane) ?? null)
          : (sourceRef.current?.captureViewportAnchor(pane) ?? null);
    };
    window.addEventListener("forgemark:capture-view-sync", onCapture);
    return () => window.removeEventListener("forgemark:capture-view-sync", onCapture);
  }, [state.viewMode, isActive]);

  useEffect(() => {
    const anchor = pendingViewSyncRef.current;
    if (!anchor) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (state.viewMode === "rendered") {
          handleRef.current?.scrollToViewportAnchor(anchor);
        } else {
          sourceRef.current?.scrollToViewportAnchor(anchor);
        }
        pendingViewSyncRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [state.viewMode]);

  // Card focus → bring the matching anchor span into view. Smooth
  // scroll with `block: nearest` so we only move when the anchor
  // is actually off-screen.
  useEffect(() => {
    if (state.viewMode !== "rendered") return;
    if (state.focusedCommentId == null) return;
    // The anchor lives inside the report's iframe, which the pane can't
    // reach with a querySelector and which can't scroll its own host.
    if (isHtml) {
      htmlRef.current?.scrollToComment(state.focusedCommentId);
      return;
    }
    const pane = paneRef.current;
    if (!pane) return;
    const span = pane.querySelector<HTMLElement>(`[data-anchor-id="${state.focusedCommentId}"]`);
    if (!span || typeof span.scrollIntoView !== "function") return;
    span.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.focusedCommentId, state.viewMode, isHtml]);

  // Source mode has its own scrollToMarker handle.
  useEffect(() => {
    if (state.viewMode !== "source") return;
    if (state.focusedCommentId == null) return;
    sourceRef.current?.scrollToMarker(state.focusedCommentId);
  }, [state.viewMode, state.focusedCommentId]);

  // Whether the pending anchor can carry a suggestion.
  //
  // Accepting a suggestion replaces everything between the markers with
  // the proposed text. In Markdown that region is prose. In an HTML
  // report it may be markup — a whole figure, or a sentence whose source
  // runs through `<code>` and `<b>` tags — and replacing markup with a
  // sentence would mangle the document. Wording changes, which is what
  // suggestions actually are, pass this test; anything else is offered
  // as a plain comment instead.
  const canSuggest = useCallback(
    (anchorKind: "element" | undefined, from: number, to: number) => {
      // Markdown anchors are always plain text. In a report the markers
      // may enclose markup, and accepting a suggestion replaces
      // everything between them — see `suggestion` below.
      if (!isHtml) return true;
      if (anchorKind === "element") return false;
      return !state.body.slice(from, to).includes("<");
    },
    [isHtml, state.body],
  );

  const suggestion = useMemo((): { allowed: boolean; reason?: string } => {
    const c = state.composer;
    if (!c || c.mode !== "new" || !isHtml) return { allowed: true };
    if (c.anchorKind === "element") {
      return { allowed: false, reason: "Comment only — this is a figure" };
    }
    if (state.body.slice(c.from, c.to).includes("<")) {
      return { allowed: false, reason: "Comment only — this passage spans markup" };
    }
    return { allowed: true };
  }, [state.composer, state.body, isHtml]);

  // Phase 9: count lost anchors. The banner picks the *first* lost
  // anchor (by id) when the user clicks Recover, then the modal
  // walks remaining orphans on subsequent clicks.
  const lostAnchorIds: number[] = [];
  for (const c of state.comments) {
    const st = anchorStatuses.get(c.id);
    if (st && st.kind === "orphaned") lostAnchorIds.push(c.id);
  }

  // Orphans whose top candidate is unambiguous. An exact text match, or
  // an element found by the id the comment recorded, needs no decision
  // from the reviewer — and after a report is regenerated there may be a
  // dozen of them at once.
  const confidentReattachments = useMemo(() => {
    const out: { commentId: number; from: number; to: number; text: string }[] = [];
    for (const c of state.comments) {
      const st = anchorStatuses.get(c.id);
      if (st?.kind !== "orphaned") continue;
      const [best, runnerUp] = st.candidates;
      if (!best || best.score < CONFIDENT_SCORE) continue;
      // Two equally good matches is exactly the case a human should look
      // at: the passage appears twice and only they know which one.
      if (runnerUp && runnerUp.score >= CONFIDENT_SCORE) continue;
      out.push({ commentId: c.id, from: best.from, to: best.to, text: best.text });
    }
    return out;
  }, [state.comments, anchorStatuses]);

  const reattachConfident = useCallback(() => {
    if (confidentReattachments.length === 0) return;
    // Splice from the end backwards so each insertion leaves the offsets
    // of the ones still to come untouched.
    const ordered = [...confidentReattachments].sort((a, b) => b.from - a.from);
    let body = state.body;
    let lastStart = Infinity;
    const entries: {
      commentId: number;
      anchor_text: string;
      context_before: string;
      context_after: string;
    }[] = [];
    for (const item of ordered) {
      // Candidates for different comments can overlap; the format can't
      // represent that, so the later one is left for the modal.
      if (item.to > lastStart) continue;
      lastStart = item.from;
      const before = body.slice(Math.max(0, item.from - 200), item.from);
      const after = body.slice(item.to, item.to + 200);
      body = insertMarkersIntoBody(body, item.from, item.to, item.commentId);
      entries.push({
        commentId: item.commentId,
        anchor_text: item.text,
        context_before: contextSnippet(before, "before"),
        context_after: contextSnippet(after, "after"),
      });
    }
    dispatch({ type: "reattachComments", body, entries });
  }, [confidentReattachments, state.body, dispatch]);

  return (
    <main
      ref={paneRef}
      className="fm-editor-pane"
      data-testid="fm-editor-pane"
      data-doc-id={id}
      data-active={isActive ? "true" : "false"}
      // Inactive panes stay mounted (that's the point — undo, cursor and
      // scroll survive a tab switch) but are taken out of the layout and
      // hidden from assistive tech and find-in-page.
      hidden={!isActive}
      style={isActive ? undefined : { display: "none" }}
      onScroll={(e) => {
        if (isActive) scrollTopRef.current = e.currentTarget.scrollTop;
      }}
      role="main"
    >
      {findState.open && (
        <FindReplaceBar
          query={findState.query}
          replacement={findState.replacement}
          replaceVisible={findState.replaceVisible}
          matchCount={findState.matches.length}
          activeIndex={findState.activeIndex}
          readOnly={state.readOnly}
          onQueryChange={(query) =>
            setFindState((prev) => ({ ...prev, query, activeIndex: query ? 0 : -1 }))
          }
          onReplacementChange={(replacement) => setFindState((prev) => ({ ...prev, replacement }))}
          onToggleReplace={() =>
            setFindState((prev) => ({ ...prev, replaceVisible: !prev.replaceVisible }))
          }
          onNext={() => moveActiveMatch(1)}
          onPrevious={() => moveActiveMatch(-1)}
          onReplace={replaceActiveMatch}
          onReplaceAll={replaceAllMatches}
          onClose={closeFindReplace}
        />
      )}
      {state.viewMode === "source" && (
        <aside
          className="fm-source-chip"
          data-testid="fm-source-chip"
          title="You can read here, but commenting only works in Rendered view."
          aria-label="Source view, read-only review"
        >
          <span className="fm-source-chip-dot" aria-hidden="true" />
          <span>Source view · read-only review</span>
        </aside>
      )}
      {/* An HTML report can be commented on but not rewritten. Saying so
          up front is better than letting someone discover it by trying
          to type — the editing they can't do is the only thing that
          differs from a Markdown document. */}
      {state.viewMode === "rendered" && isHtml && (
        <aside
          className="fm-source-chip"
          data-testid="fm-html-chip"
          title="Select any passage to comment, or hover a figure or table. The report's own text isn't editable here."
          aria-label="HTML report, review only"
        >
          <span className="fm-source-chip-dot" aria-hidden="true" />
          <span>HTML report · review only</span>
        </aside>
      )}
      <div className="fm-document">
        <LostAnchorBanner
          count={lostAnchorIds.length}
          onRecover={() => {
            if (lostAnchorIds.length === 0) return;
            dispatch({ type: "openReattach", commentId: lostAnchorIds[0] });
          }}
          confidentCount={confidentReattachments.length}
          onReattachConfident={reattachConfident}
        />
        {state.viewMode === "source" ? (
          <SourceView ref={sourceRef} text={sourceText} format={state.format} />
        ) : isHtml ? (
          <HtmlView
            key={state.loadGeneration}
            body={state.body}
            comments={state.comments}
            focusedCommentId={state.focusedCommentId}
            hoveredCommentId={state.hoveredCommentId}
            onAnchorClick={(id) => {
              // A click inside the frame never reaches the host window,
              // so the menu's own click-away listener can't see it.
              setContextMenu(null);
              dispatch({ type: "setFocusedComment", id });
            }}
            onAnchorHover={(id) => dispatch({ type: "setHoveredComment", id })}
            onRequestElementComment={(capture) => openComposerFor(capture)}
            onContextMenu={(at) => setContextMenu({ x: at.x, y: at.y })}
            // Background documents stay mounted, and the toolbar is
            // position:fixed — an inactive pane must neither poll nor
            // paint one over the document in front.
            onSelectionChange={isActive ? showAffordance : undefined}
            handleRef={htmlRef}
          />
        ) : (
          <RenderedView
            // Remount on every content-replacing load so the Tiptap undo
            // stack can't outlive the document it belongs to.
            key={state.loadGeneration}
            body={state.body}
            onEdit={(body) => dispatch({ type: "edit", body })}
            readOnly={editorReadOnly}
            focusedCommentId={state.focusedCommentId}
            hoveredCommentId={state.hoveredCommentId}
            onAnchorClick={(id) => dispatch({ type: "setFocusedComment", id })}
            onAnchorHover={(id) => dispatch({ type: "setHoveredComment", id })}
            onExternalLinkError={(message) => dispatch({ type: "error", message })}
            handleRef={handleRef}
            onSelectionChange={
              isActive
                ? (captured) => showAffordance(captured && fromMarkdownCapture(captured))
                : undefined
            }
          />
        )}
      </div>
      {isActive &&
        state.viewMode === "rendered" &&
        selectionAffordance != null &&
        state.composer == null &&
        contextMenu == null &&
        // Find selects each match as you step through them; that is
        // navigation, not a passage the reader wants to comment on.
        !findState.open && (
          <SelectionToolbar
            x={selectionAffordance.rect.left}
            y={selectionAffordance.rect.top}
            allowSuggest={canSuggest(
              selectionAffordance.kind === "element" ? "element" : undefined,
              selectionAffordance.from,
              selectionAffordance.to,
            )}
            onComment={() => openComposerFor(selectionAffordance, "comment")}
            onSuggest={() => openComposerFor(selectionAffordance, "suggest")}
          />
        )}
      {state.composer?.mode === "new" && state.viewMode === "rendered" && (
        <NewCommentComposer
          x={state.composer.x}
          y={state.composer.y}
          selectionPreview={state.composer.selectionText}
          onSubmitComment={submitComment}
          onSubmitSuggestion={submitSuggestion}
          onCancel={cancelComposer}
          initialMode={state.composer.initialMode}
          allowSuggest={suggestion.allowed}
          suggestUnavailableReason={suggestion.reason}
        />
      )}
      {state.composer?.mode === "overlapPrompt" && state.viewMode === "rendered" && (
        <OverlapPrompt
          x={state.composer.x}
          y={state.composer.y}
          onReply={replyToOverlap}
          onCancel={cancelComposer}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: "New Comment",
              onSelect: () => openComposer("comment"),
              testid: "fm-context-new-comment",
            },
            {
              label: "Suggest Edit",
              onSelect: () => openComposer("suggest"),
              testid: "fm-context-suggest-edit",
            },
          ]}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </main>
  );
}
