import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildHtmlTextMap, insertMarkersIntoBody, textRangeToSource } from "../format";
import type { Comment } from "../format/types";
import {
  anchorElement,
  anchorStylesheet,
  applyAnchorState,
  decorateAnchors,
} from "../services/htmlDecorate";
import {
  describeElement,
  elementAnchorTarget,
  renderedText,
  selectionTextRange,
} from "../services/htmlDom";
import { useTheme } from "../theme/ThemeProvider";
import "./HtmlView.css";

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
  // Host-viewport coordinates, for positioning the composer.
  rect: { left: number; bottom: number };
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
  // frame forwards it with host-viewport coordinates.
  onContextMenu?: (at: { x: number; y: number }) => void;
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
  handleRef,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
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
  });
  latest.current = {
    onAnchorClick,
    onAnchorHover,
    onRequestElementComment,
    onContextMenu,
    textMap,
    body,
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
  }, []);

  // Selection → source offsets. Shared by the ⌘⌥M path and the handle.
  const capture = useCallback((): HtmlCapturedSelection | null => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const root = doc?.body;
    if (!frame || !doc || !root) return null;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);

    const textRange = selectionTextRange(root, range);
    if (!textRange) return null;

    const map = latest.current.textMap;
    const text = map.text.slice(textRange.from, textRange.to);
    if (text.trim().length === 0) return null;

    const frameRect = frame.getBoundingClientRect();
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    const rect = {
      left: frameRect.left + last.left,
      bottom: frameRect.top + last.bottom,
    };

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
      doc.open();
      doc.write(body);
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

      // The affordance for commenting on a chart or table. Injected by
      // the host because the report's own scripts never run.
      const button = doc.createElement("button");
      button.className = "fm-element-target";
      button.type = "button";
      button.textContent = "Comment";
      button.setAttribute("data-visible", "false");
      doc.body?.appendChild(button);

      let armed: Element | null = null;
      const hideButton = () => {
        armed = null;
        button.setAttribute("data-visible", "false");
      };
      const showButtonFor = (el: Element) => {
        armed = el;
        const rect = el.getBoundingClientRect();
        const top = rect.top + (doc.defaultView?.scrollY ?? 0);
        const left = rect.left + (doc.defaultView?.scrollX ?? 0);
        button.style.top = `${Math.max(0, top + 6)}px`;
        button.style.left = `${Math.max(0, left + rect.width - 84)}px`;
        button.setAttribute("data-visible", "true");
      };

      const findAnchorId = (target: EventTarget | null): number | null => {
        if (!(target instanceof doc.defaultView!.Element)) return null;
        const el = (target as Element).closest("[data-anchor-id]");
        const raw = el?.getAttribute("data-anchor-id");
        const id = raw == null ? NaN : Number(raw);
        return Number.isFinite(id) ? id : null;
      };

      const onClick = (e: Event) => {
        if (e.target === button) {
          e.preventDefault();
          if (armed) {
            const capture = captureElement(armed, frame, latest.current.body);
            if (capture) latest.current.onRequestElementComment(capture);
          }
          hideButton();
          return;
        }
        // Links inside a report would navigate the iframe away from the
        // document under review. Nothing here opens them yet, so the
        // safe behaviour is to do nothing rather than lose the report.
        const link = (e.target as Element | null)?.closest?.("a[href]");
        if (link) e.preventDefault();
        latest.current.onAnchorClick(findAnchorId(e.target));
      };

      const onMouseOver = (e: Event) => {
        const id = findAnchorId(e.target);
        if (id !== null) latest.current.onAnchorHover(id);
        const target = elementAnchorTarget(e.target as Node | null);
        if (target) showButtonFor(target);
        else if (e.target !== button) hideButton();
      };
      const onMouseOut = (e: Event) => {
        if (findAnchorId(e.target) !== null) latest.current.onAnchorHover(null);
      };

      const onFrameContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) return;
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
        const el = anchorElement(doc, id);
        const pane = frame.closest<HTMLElement>(".fm-editor-pane");
        if (!el || !pane) return;
        const top = el.getBoundingClientRect().top + (doc.defaultView?.scrollY ?? 0);
        const paneRect = pane.getBoundingClientRect();
        const frameTop = frame.getBoundingClientRect().top - paneRect.top + pane.scrollTop;
        pane.scrollTo({ top: Math.max(0, frameTop + top - 80), behavior: "smooth" });
      },
    };
    return () => {
      if (handleRef.current) handleRef.current = null;
    };
  }, [capture, handleRef]);

  return (
    <iframe
      ref={frameRef}
      className="fm-html-view"
      data-testid="fm-html-view"
      title="Report under review"
      // No allow-scripts: the report's own scripts must not run. See the
      // note at the top of this file for why the pairing matters.
      sandbox="allow-same-origin"
    />
  );
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
  frame: HTMLIFrameElement,
  body: string,
): HtmlCapturedSelection | null {
  const existing = el.closest("[data-anchor-id]");
  const frameRect = frame.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const at = {
    left: frameRect.left + rect.left,
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
