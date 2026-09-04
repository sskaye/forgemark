import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildHtmlTextMap, insertMarkersIntoBody, textRangeToSource } from "../format";
import type { Comment } from "../format/types";
import {
  anchorElement,
  anchorStylesheet,
  applyAnchorState,
  decorateAnchors,
} from "../services/htmlDecorate";
import { describeElement, renderedText, selectionTextRange } from "../services/htmlDom";
import { useTheme } from "../theme/ThemeProvider";
import "./HtmlView.css";
import { anchorIdOf } from "../services/anchorDom";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { assetUrl, classifyLink } from "../services/documentLinks";
import { deliverOpenPath } from "../state/menuBridge";

// Rendered view for HTML documents.
//
// The report is loaded verbatim into a sandboxed iframe rather than
// parsed into an editor model. That is the whole design, and it is
// forced by what these documents are: a generated report is a `<style>`
// block, inline `<svg>`, and a pile of CSS classes, none of which
// survives a round trip through a rich-text schema. Tiptap would render
// something that looked roughly right and save something that wasn't.
//
// Two consequences worth stating plainly:
//
//   - `sandbox="allow-same-origin"` *without* `allow-scripts` means the
//     report's own scripts never run, while Forgemark can still reach
//     `contentDocument` to decorate anchors and read selections. Adding
//     `allow-scripts` alongside `allow-same-origin` would be equivalent
//     to no sandbox at all, so it isn't offered.
//   - An iframe can't inherit the host page's CSS, which here is a
//     feature: the example report defines its entire palette on `:root`
//     with a `prefers-color-scheme` block. Rendering it inside the app's
//     own document — or in a shadow root, where `:root` doesn't resolve
//     — would break it.
//
// The iframe is sized to its content so it never scrolls internally; the
// editor pane scrolls, which keeps scroll position, comment cards, and
// the view-sync machinery working the way they do for Markdown.

export type HtmlCapturedSelection = {
  // Offsets into the *source*, ready to splice markers into.
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
  kind: "inline" | "element";
  // A stable selector for an element anchor, when the report gave the
  // element an id. Only ids qualify: positional selectors look stable and
  // aren't, since the next generation of the report may add a figure.
  anchorSelector?: string;
  // Set when the selection can't be anchored, with a user-facing reason.
  rejectReason?: string;
  overlappingAnchorId: number | null;
  // Host-viewport coordinates. `bottom` anchors the composer below the
  // selection; `top` anchors the selection toolbar above it.
  rect: { left: number; top: number; bottom: number };
};

export type HtmlViewHandle = {
  captureSelection(): HtmlCapturedSelection | null;
  // Splice a marker pair into the source and return the new body.
  applyAnchor(from: number, to: number, id: number): string;
  selectedText(): string | null;
  scrollToComment(id: number): void;
};

type Props = {
  body: string;
  comments: Comment[];
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  onAnchorClick: (id: number | null) => void;
  onAnchorHover: (id: number | null) => void;
  // Raised when the reader asks to comment on a block that has no text
  // to select — a chart, a figure, a table.
  onRequestElementComment: (capture: HtmlCapturedSelection) => void;
  // Right-click inside an iframe never reaches the host window, so the
  // frame forwards it with host-viewport coordinates. Not every engine
  // delivers it, which is why it is not the only way in.
  onContextMenu?: (at: { x: number; y: number }) => void;
  // Fires as the reader selects and deselects text in the report, so the
  // host can float a Comment / Suggest edit affordance at the selection.
  onSelectionChange?: (capture: HtmlCapturedSelection | null) => void;
  // The folder the report is in: a stylesheet, image, or link written
  // relative to the report resolves against it.
  baseDir?: string | null;
  onLinkError?: (message: string) => void;
  handleRef?: React.MutableRefObject<HtmlViewHandle | null>;
};

export function HtmlView({
  body,
  comments,
  focusedCommentId,
  hoveredCommentId,
  onAnchorClick,
  onAnchorHover,
  onRequestElementComment,
  onContextMenu,
  onSelectionChange,
  baseDir = null,
  onLinkError,
  handleRef,
}: Props) {
  // Commentable blocks and where they sit inside the frame, so the host
  // can put a button over each one. See `readBlocks`.
  const [blocks, setBlocks] = useState<BlockAffordance[]>([]);
  // Whether the pane is wide enough to hold the block buttons in the
  // margin beside the report rather than on top of it.
  const [gutter, setGutter] = useState(true);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Lets the frame's own listeners nudge the selection watcher, without
  // the watcher having to know when the frame was (re)written.
  const pokeSelectionRef = useRef<() => void>(() => {});
  const { theme } = useTheme();

  // Rebuilt whenever the source changes — which for an HTML document
  // means a comment was added, accepted, or removed, since the prose
  // itself is not editable.
  const textMap = useMemo(() => buildHtmlTextMap(body), [body]);
  const resolvedIds = useMemo(
    () => new Set(comments.filter((c) => c.resolved).map((c) => c.id)),
    [comments],
  );

  // Latest-value refs. The iframe's listeners are attached once per load
  // and must not capture a stale render's props.
  const latest = useRef({
    onAnchorClick,
    onAnchorHover,
    onRequestElementComment,
    onContextMenu,
    textMap,
    body,
    baseDir,
    onLinkError,
  });
  latest.current = {
    onAnchorClick,
    onAnchorHover,
    onRequestElementComment,
    onContextMenu,
    textMap,
    body,
    baseDir,
    onLinkError,
  };

  const stylesheet = useMemo(
    () =>
      anchorStylesheet({
        anchorBg: theme.anchorBg,
        anchorBgHover: theme.anchorBgHover,
        anchorBgFocus: theme.anchorBgFocus,
        anchorBgResolved: theme.anchorBgResolved,
        anchorUnderline: theme.anchorUnderline,
        accent: theme.accent,
        surface: theme.cardBg,
        text: theme.proseInk,
        border: theme.cardBorder,
      }),
    [theme],
  );

  // Size the iframe to its content. The pane owns scrolling.
  const syncHeight = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    const height = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
      // A short report shouldn't leave the pane looking empty.
      320,
    );
    frame.style.height = `${height}px`;
    // Only when something moved: every observer pass used to hand React
    // a fresh array and re-render every button.
    setBlocks((prev) => {
      const next = readBlocks(doc);
      return sameBlocks(prev, next) ? prev : next;
    });

    // A report fills the frame edge to edge, so a button placed at a
    // block's corner lands on top of its caption. The pane is usually
    // much wider than the document, though, so the buttons go in the
    // margin — falling back to the corner only when there isn't one.
    const pane = frame.closest<HTMLElement>(".fm-editor-pane");
    if (pane) {
      const room = pane.getBoundingClientRect().right - frame.getBoundingClientRect().right;
      setGutter(room >= GUTTER_MIN);
    }
  }, []);

  // Re-measure when the pane changes width — the sidebar being toggled,
  // the window being resized. The observer inside the frame only sees the
  // report's own box, so it cannot answer whether there is still a margin
  // out here to put the block buttons in.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => syncHeight());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [syncHeight]);

  // Selection → source offsets. Shared by the ⌘⌥M path and the handle.
  const capture = useCallback((): HtmlCapturedSelection | null => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return null;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);

    // The Document, not <body> — see `walkTextNodes`. The source map
    // walks the whole tree, and the two coordinate spaces must agree
    // exactly or every anchor after the first mismatch lands off by one.
    const textRange = selectionTextRange(doc, range);
    if (!textRange) return null;

    const map = latest.current.textMap;
    const text = map.text.slice(textRange.from, textRange.to);
    if (text.trim().length === 0) return null;

    const rect = composerAnchorRect(frame, range);

    const overlappingAnchorId = overlappingAnchor(range);

    const span = textRangeToSource(map, textRange.from, textRange.to, { requireExact: true });
    if (!span) {
      return {
        from: 0,
        to: 0,
        text,
        contextBefore: "",
        contextAfter: "",
        kind: "inline",
        rejectReason:
          "This passage can't be anchored precisely. Try selecting a little more of the sentence.",
        overlappingAnchorId,
        rect,
      };
    }

    return {
      from: span.start,
      to: span.end,
      text,
      contextBefore: map.text.slice(Math.max(0, textRange.from - 80), textRange.from).trim(),
      contextAfter: map.text.slice(textRange.to, textRange.to + 80).trim(),
      kind: "inline",
      overlappingAnchorId,
      rect,
    };
  }, []);

  // Watch the reader's selection, by polling from the host.
  //
  // Polling rather than listening looks wrong and isn't. Every event a
  // selection would announce itself with — `mouseup`, `keyup`,
  // `selectionchange` — is raised inside the frame's own document, and
  // whether a listener the host attached there is ever called is up to
  // the embedder's engine. WKWebView shows its native menu on right-click
  // in a report, which means our in-frame `contextmenu` handler is not
  // suppressing it, so that delivery cannot be relied on for the one
  // affordance the reader needs most.
  //
  // Reading the selection across the boundary is a different capability,
  // and one we already depend on: `allow-same-origin` grants it, and ⌘⌥M
  // has worked on that basis from the start. So the toolbar is driven by
  // what we can read, not by what we hope gets dispatched.
  //
  // The frame's own `selectionchange` / `mouseup` fire this immediately
  // where they are delivered, so the toolbar is instant in practice; the
  // interval is the floor that guarantees it appears at all. Both call
  // the same function, and it is idempotent.
  //
  // Cost is one `isCollapsed` check every 200ms, with the expensive part
  // guarded behind it.
  useEffect(() => {
    if (!onSelectionChange) {
      pokeSelectionRef.current = () => {};
      return;
    }
    let lastKey = "";
    let lastAnchorId: number | null = null;
    const tick = () => {
      const doc = frameRef.current?.contentDocument;
      const selection = doc?.getSelection();

      // Clicking an anchored passage should focus its card. That normally
      // rides on the frame's own click event, which an embedder may not
      // deliver — but the click also moves the caret, and the caret we can
      // read. This only ever *sets* a focus, never clears one: clearing
      // from here would fight the sidebar, where clicking a card focuses a
      // comment whose passage the caret is nowhere near.
      const caretAnchorId = anchorIdAt(selection?.anchorNode ?? null);
      if (caretAnchorId == null) {
        lastAnchorId = null;
      } else if (caretAnchorId !== lastAnchorId) {
        lastAnchorId = caretAnchorId;
        latest.current.onAnchorClick(caretAnchorId);
      }

      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        if (lastKey !== "") {
          lastKey = "";
          onSelectionChange(null);
        }
        return;
      }
      const range = selection.getRangeAt(0);
      // Offsets and length alone are not identity: the same three
      // numbers describe "abc" at the start of one paragraph and "xyz"
      // at the start of the next, and treating those as unchanged would
      // strand the toolbar over the previous passage. Position on screen
      // is what the toolbar actually tracks, so it belongs in the key.
      const box = rectOf(range);
      const key = [
        range.startOffset,
        range.endOffset,
        selection.toString().length,
        Math.round(box.top),
        Math.round(box.left),
      ].join(":");
      if (key === lastKey) return;
      lastKey = key;
      onSelectionChange(capture());
    };
    pokeSelectionRef.current = tick;
    const handle = window.setInterval(tick, 200);
    return () => {
      window.clearInterval(handle);
      pokeSelectionRef.current = () => {};
    };
  }, [capture, onSelectionChange]);

  // Load the source into the frame and decorate it. Deliberately keyed on
  // `body` alone: a comment add rewrites the source, so the frame is
  // rewritten, and the pane's scroll position is restored afterwards
  // because the added markers are invisible and change no layout.
  //
  // The document is written rather than handed over as `srcdoc` because
  // writing is synchronous — there is no load event to race, so
  // decoration and the imperative handle are ready in the same tick the
  // body changes. The sandbox flags are a property of the browsing
  // context and apply either way, so the report's scripts still never
  // run.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const pane = frame.closest<HTMLElement>(".fm-editor-pane");
    const restoreScroll = pane?.scrollTop ?? 0;

    const write = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      // The elements these point at are about to be discarded.
      setBlocks([]);
      doc.open();
      // A `<base>` at the folder the report is in, so a stylesheet,
      // font, or image written relative to the report loads. It has no
      // text, so the source text map is unaffected.
      doc.write(withBase(body, latest.current.baseDir));
      doc.close();

      // Reports written for the artifact convention honour an explicit
      // `data-theme`; ones that don't are unaffected by the attribute.
      doc.documentElement.setAttribute("data-theme", theme.name);

      const style = doc.createElement("style");
      style.setAttribute("data-forgemark", "anchors");
      style.textContent = stylesheet;
      (doc.head ?? doc.documentElement).appendChild(style);

      decorateAnchors(doc);
      applyAnchorState(doc, focusedCommentId, hoveredCommentId, resolvedIds);

      const findAnchorId = anchorIdOf;

      const onClick = (e: Event) => {
        // A link must never navigate the frame away from the report.
        // An address opens outside; a fragment scrolls the pane to its
        // target; another document opens in a tab; any other file opens
        // with whatever the system uses for it.
        const link = (e.target as Element | null)?.closest?.("a[href]");
        if (link) {
          e.preventDefault();
          const target = classifyLink(link.getAttribute("href"), latest.current.baseDir);
          const failed = (what: string) => (err: unknown) => {
            const detail = err instanceof Error ? err.message : String(err);
            latest.current.onLinkError?.(`${what} failed: ${detail}`);
          };
          if (target.kind === "external") void openUrl(target.url).catch(failed("Open link"));
          else if (target.kind === "fragment") scrollPaneTo(frame, doc.getElementById(target.id));
          else if (target.kind === "document") deliverOpenPath(target.path);
          else if (target.kind === "file") void openPath(target.path).catch(failed("Open file"));
          return;
        }
        latest.current.onAnchorClick(findAnchorId(e.target));
      };

      const onMouseOver = (e: Event) => {
        const id = findAnchorId(e.target);
        if (id !== null) latest.current.onAnchorHover(id);
      };
      const onMouseOut = (e: Event) => {
        if (findAnchorId(e.target) !== null) latest.current.onAnchorHover(null);
      };

      // Remember the reader's last real selection.
      //
      // A right-click into a frame that doesn't already hold focus
      // focuses it first, and focusing a browsing context can collapse
      // its selection — so by the time `contextmenu` fires, the passage
      // the reader is pointing at may no longer be selected, and the
      // menu would silently never open. A document rendered in the host
      // window never hits this, which is why the Markdown path doesn't
      // need it.
      let remembered: Range | null = null;
      const rememberSelection = () => {
        // Tell the watcher straight away; it is cheap and idempotent.
        pokeSelectionRef.current();
        const selection = doc.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        if (selection.toString().trim().length === 0) return;
        remembered = selection.getRangeAt(0).cloneRange();
      };
      doc.addEventListener("mouseup", rememberSelection);
      doc.addEventListener("keyup", rememberSelection);
      doc.addEventListener("selectionchange", rememberSelection);

      // Where a range sits on screen. Ranges are the one thing whose
      // layout API a document we did not create may not implement, so
      // this steps down to the enclosing element rather than throwing —
      // and reports nothing measurable rather than guessing.
      const boxesFor = (range: Range): DOMRect[] => {
        if (typeof range.getClientRects === "function") {
          const rects = range.getClientRects();
          if (rects.length > 0) return Array.from(rects);
        }
        if (typeof range.getBoundingClientRect === "function") {
          return [range.getBoundingClientRect()];
        }
        const node = range.commonAncestorContainer;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        return el ? [el.getBoundingClientRect()] : [];
      };

      // Whether a point falls inside a range, with a little slack for the
      // click landing on the edge of a glyph.
      const rangeContainsPoint = (range: Range, x: number, y: number): boolean =>
        boxesFor(range).some(
          (r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2,
        );

      const onFrameContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const selection = doc.getSelection();
        const live = selection && !selection.isCollapsed && selection.toString().trim().length > 0;

        if (!live) {
          // Put the reader's selection back, but only when they actually
          // right-clicked on it — restoring a selection somewhere else on
          // the page would be worse than doing nothing.
          if (!remembered || !selection) return;
          try {
            if (!rangeContainsPoint(remembered, e.clientX, e.clientY)) return;
            selection.removeAllRanges();
            selection.addRange(remembered);
          } catch {
            return;
          }
          if (selection.toString().trim().length === 0) return;
        }

        const frameRect = frame.getBoundingClientRect();
        latest.current.onContextMenu?.({
          x: frameRect.left + e.clientX,
          y: frameRect.top + e.clientY,
        });
      };

      doc.addEventListener("click", onClick);
      doc.addEventListener("mouseover", onMouseOver);
      doc.addEventListener("mouseout", onMouseOut);
      doc.addEventListener("contextmenu", onFrameContextMenu);

      syncHeight();
      // Late layout (web fonts, images) can change the height after load.
      const observer = doc.defaultView?.ResizeObserver
        ? new doc.defaultView.ResizeObserver(syncHeight)
        : null;
      if (observer && doc.documentElement) observer.observe(doc.documentElement);

      if (pane && restoreScroll > 0) {
        requestAnimationFrame(() => {
          pane.scrollTop = restoreScroll;
        });
      }

      cleanupRef.current = () => {
        observer?.disconnect();
        doc.removeEventListener("click", onClick);
        doc.removeEventListener("mouseover", onMouseOver);
        doc.removeEventListener("mouseout", onMouseOut);
        doc.removeEventListener("contextmenu", onFrameContextMenu);
        doc.removeEventListener("mouseup", rememberSelection);
        doc.removeEventListener("keyup", rememberSelection);
        doc.removeEventListener("selectionchange", rememberSelection);
      };
    };

    write();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // Theme and comment state are applied by their own effects below;
    // re-running this one would needlessly reload the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // Focus / hover / resolved state, without reloading.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    applyAnchorState(doc, focusedCommentId, hoveredCommentId, resolvedIds);
  }, [focusedCommentId, hoveredCommentId, resolvedIds, body]);

  // Theme changes restyle in place — the report is not reloaded.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.documentElement.setAttribute("data-theme", theme.name);
    const style = doc.querySelector('style[data-forgemark="anchors"]');
    if (style) style.textContent = stylesheet;
  }, [stylesheet, theme.name]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      captureSelection: capture,
      applyAnchor: (from, to, id) => insertMarkersIntoBody(latest.current.body, from, to, id),
      selectedText: () => {
        const doc = frameRef.current?.contentDocument;
        const text = doc?.getSelection()?.toString().trim();
        return text && text.length > 0 ? text : null;
      },
      scrollToComment: (id: number) => {
        const frame = frameRef.current;
        const doc = frame?.contentDocument;
        if (!frame || !doc) return;
        scrollPaneTo(frame, anchorElement(doc, id));
      },
    };
    return () => {
      if (handleRef.current) handleRef.current = null;
    };
  }, [capture, handleRef]);

  return (
    <div className="fm-html-frame" ref={wrapperRef}>
      <iframe
        ref={frameRef}
        className="fm-html-view"
        data-testid="fm-html-view"
        title="Report under review"
        // No allow-scripts: the report's own scripts must not run. See the
        // note at the top of this file for why the pairing matters.
        sandbox="allow-same-origin"
      />
      {/* The way to comment on a chart or a table.
       *
       * These live in the *host* document, positioned over the frame,
       * rather than being injected into it. An injected button has to be
       * reached by a click delivered to a listener the host attached
       * inside the frame, and an embedder is free not to do that —
       * WKWebView doesn't, which left this silently dead. Out here the
       * button is an ordinary part of the app and is clicked normally. */}
      {blocks.map((block) => (
        <button
          key={block.key}
          type="button"
          className="fm-block-comment"
          data-testid="fm-block-comment"
          data-placement={gutter ? "gutter" : "inset"}
          style={
            gutter
              ? { top: block.top, left: "calc(100% + 10px)" }
              : { top: block.top, left: block.right - 6, transform: "translateX(-100%)" }
          }
          title={`Comment on ${block.label}`}
          aria-label={`Comment on ${block.label}`}
          onClick={() => {
            const capture = captureElement(block.el, frameRef.current, latest.current.body);
            if (capture) latest.current.onRequestElementComment(capture);
          }}
        >
          Comment
        </button>
      ))}
    </div>
  );
}

// A block a comment can be anchored to as a unit, and where it sits
// inside the frame.
export type BlockAffordance = {
  key: string;
  // Offsets from the frame's own top-left. The frame is sized to its
  // content and so never scrolls internally, which makes an element's
  // client rect its offset within the document — and the host wrapper
  // starts at the same origin, so these are usable as-is for positioning.
  top: number;
  right: number;
  label: string;
  el: Element;
};

const BLOCK_SELECTOR = "figure, table, blockquote, pre, img, video, svg";

// Room the margin needs before a button is put there: the button's own
// width plus the gap either side of it.
const GUTTER_MIN = 96;

const anchorIdAt = anchorIdOf;

function isHidden(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return false;
  try {
    const style = view.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function sameBlocks(a: BlockAffordance[], b: BlockAffordance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.el !== y.el || x.top !== y.top || x.right !== y.right || x.key !== y.key) return false;
  }
  return true;
}

// The outermost commentable blocks in the report.
//
// Outermost because a `<figure>` wrapping a chart is the unit a reviewer
// means when they point at it; offering the figure *and* the `<svg>`
// inside it would be two buttons for one intent.
function readBlocks(doc: Document): BlockAffordance[] {
  const all = Array.from(doc.querySelectorAll(BLOCK_SELECTOR));
  // Outermost: nothing above it matches the selector. A report full of
  // inline SVG icons made the pairwise version quadratic.
  const outermost = all.filter((el) => !el.parentElement?.closest(BLOCK_SELECTOR));
  const out: BlockAffordance[] = [];
  outermost.forEach((el, index) => {
    // Reports sometimes carry a hidden <svg> sprite sheet; nobody wants a
    // button on that. Asked as a style question rather than a measured
    // one, so the answer doesn't depend on a layout being available —
    // "no layout" must not silently mean "no buttons".
    if (isHidden(el)) return;
    let rect: { top: number; right: number };
    try {
      rect = el.getBoundingClientRect();
    } catch {
      rect = { top: 0, right: 0 };
    }
    out.push({
      key: `${index}:${el.tagName}`,
      top: rect.top,
      right: rect.right,
      label: describeElement(el),
      el,
    });
  });
  return out;
}

// A range's bounding box, or a zero box when the document doesn't
// implement the layout API. Only ever used to notice movement, so a
// constant answer degrades to "never moved" rather than to a crash.
function rectOf(range: Range): { top: number; left: number } {
  try {
    if (typeof range.getBoundingClientRect === "function") {
      const r = range.getBoundingClientRect();
      return { top: r.top, left: r.left };
    }
  } catch {
    /* fall through */
  }
  return { top: 0, left: 0 };
}

// Where to float the composer: just under the end of the selection, in
// host-viewport coordinates.
//
// Layout APIs are the one thing that can be missing or partial in a
// document we did not create — and this is cosmetic, so it must never be
// the reason a comment can't be added. A failure here costs the composer
// its position, not the reviewer their comment.
function composerAnchorRect(
  frame: HTMLIFrameElement,
  range: Range,
): { left: number; top: number; bottom: number } {
  const frameRect = frame.getBoundingClientRect();
  try {
    const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
    const list = rects && rects.length > 0 ? Array.from(rects) : [range.getBoundingClientRect()];
    const last = list[list.length - 1];
    const highest = list.reduce((a, b) => (b.top < a.top ? b : a), list[0]);
    return {
      left: frameRect.left + last.left,
      top: frameRect.top + highest.top,
      bottom: frameRect.top + last.bottom,
    };
  } catch {
    return { left: frameRect.left, top: frameRect.top, bottom: frameRect.top };
  }
}

// Which existing anchor, if any, a selection overlaps. The format can't
// represent overlapping anchors, so the caller diverts to a reply.
function overlappingAnchor(range: Range): number | null {
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!container) return null;

  const enclosing = container.closest("[data-anchor-id]");
  if (enclosing) {
    const id = Number(enclosing.getAttribute("data-anchor-id"));
    if (Number.isFinite(id)) return id;
  }
  for (const el of Array.from(container.querySelectorAll("[data-anchor-id]"))) {
    if (range.intersectsNode(el)) {
      const id = Number(el.getAttribute("data-anchor-id"));
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

// Build a capture for a whole element — a figure, chart, or table.
//
// Element anchors are written as a marker pair on its own lines around
// the block, which is byte-for-byte the shape Forgemark already uses for
// whole code blocks in Markdown. The anchor text is the caption the
// report author already wrote, so the sidebar card says "Figure 3.
// Protein sensitivity is hard to pin…" rather than a tag name.
function captureElement(
  el: Element,
  frame: HTMLIFrameElement | null,
  body: string,
): HtmlCapturedSelection | null {
  if (!frame) return null;
  const existing = el.closest("[data-anchor-id]");
  const frameRect = frame.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const at = {
    left: frameRect.left + rect.left,
    top: frameRect.top + rect.top,
    bottom: frameRect.top + rect.bottom,
  };

  if (existing) {
    const id = Number(existing.getAttribute("data-anchor-id"));
    return {
      from: 0,
      to: 0,
      text: describeElement(el),
      contextBefore: "",
      contextAfter: "",
      kind: "element",
      overlappingAnchorId: Number.isFinite(id) ? id : null,
      rect: at,
    };
  }

  // Locate the element's source span by matching its rendered text
  // against the document's text map. Elements are found by their own
  // text content, which is unique enough in practice for a figure or a
  // table; when it isn't, the first occurrence in document order wins,
  // and that is the one the reader is looking at in the common case.
  const span = elementSourceSpan(el, body);
  if (!span) {
    return {
      from: 0,
      to: 0,
      text: describeElement(el),
      contextBefore: "",
      contextAfter: "",
      kind: "element",
      rejectReason: "This block can't be located in the file's source.",
      overlappingAnchorId: null,
      rect: at,
    };
  }

  return {
    from: span.start,
    to: span.end,
    text: describeElement(el),
    contextBefore: "",
    contextAfter: "",
    kind: "element",
    anchorSelector: stableSelector(el),
    overlappingAnchorId: null,
    rect: at,
  };
}

// Only an id is worth recording. A positional selector
// (`figure:nth-of-type(3)`) looks stable and isn't: the next generation
// of the report may add a figure above it, and a hint that silently
// points at the wrong chart is worse than no hint.
function stableSelector(el: Element): string | undefined {
  const id = el.getAttribute("id");
  if (id && /^[A-Za-z][\w-]*$/.test(id)) return `#${id}`;
  const owner = el.closest("[id]");
  const ownerId = owner?.getAttribute("id");
  if (owner && ownerId && /^[A-Za-z][\w-]*$/.test(ownerId)) {
    return `#${ownerId} ${el.tagName.toLowerCase()}`;
  }
  return undefined;
}

// The source range covering a whole element, found by locating its outer
// HTML in the body. Exact string search is used rather than an offset
// map because an element anchor must wrap the element's *markup*, not
// its text.
function elementSourceSpan(el: Element, body: string): { start: number; end: number } | null {
  const tag = el.tagName.toLowerCase();
  const text = renderedText(el).replace(/\s+/g, " ").trim().slice(0, 60);

  // Find candidate start tags, then take the one whose rendered text
  // matches this element's.
  const openTag = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(body)) !== null) {
    const end = matchingEndTag(body, tag, match.index + match[0].length);
    if (end < 0) continue;
    const slice = body.slice(match.index, end);
    const sliceText = slice
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    if (text.length === 0 || sliceText.startsWith(text.slice(0, Math.min(30, text.length)))) {
      return { start: match.index, end };
    }
  }
  return null;
}

// Offset just past the end tag that closes the element opened before
// `from`, accounting for nesting of the same tag.
function matchingEndTag(body: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

// Bring an element inside the frame into view. The element is inside
// the frame, which can't scroll its own host, so the pane is moved
// instead. `scrollTo` is the smooth path; assigning scrollTop is the
// one that always exists.
function scrollPaneTo(frame: HTMLIFrameElement, el: Element | null): void {
  const doc = frame.contentDocument;
  const pane = frame.closest<HTMLElement>(".fm-editor-pane");
  if (!el || !doc || !pane) return;
  const top = el.getBoundingClientRect().top + (doc.defaultView?.scrollY ?? 0);
  const paneRect = pane.getBoundingClientRect();
  const frameTop = frame.getBoundingClientRect().top - paneRect.top + pane.scrollTop;
  const target = Math.max(0, frameTop + top - 80);
  if (typeof pane.scrollTo === "function") {
    pane.scrollTo({ top: target, behavior: "smooth" });
  } else {
    pane.scrollTop = target;
  }
}

// The report with a `<base href>` at its folder, placed where the
// parser sees it before any relative reference: right after `<head>`,
// or at the top when there is no head. A report that sets its own base
// keeps it.
export function withBase(html: string, baseDir: string | null): string {
  if (!baseDir || /<base\s/i.test(html)) return html;
  const folder = baseDir.endsWith("/") || baseDir.endsWith("\\") ? baseDir : `${baseDir}/`;
  const tag = `<base href="${assetUrl(folder).replace(/"/g, "&quot;")}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
    );
  return tag + html;
}
