// Forgemark's presence inside a report frame.
//
// The report runs on its own origin with its own scripts, and the app
// cannot reach into it. This script is injected into the report and does
// there what the app used to do from outside: turns marker comments
// into highlights, watches the reader's selection, puts a comment
// button beside each chart and table, and forwards clicks on anchors
// and links. It talks to the app only through the channel it is given
// (protocol.ts); it never touches the app's own window.
//
// Everything it adds to the document carries `data-forgemark`, which
// the text walks skip, so its own UI is never mistaken for the report's
// prose.

import {
  anchorStylesheet as _unused,
  applyAnchorState,
  anchorElement,
  decorateAnchors,
  decoratePassage,
  markerPair,
  removeAnchor,
} from "./decorate";
import { describeElement, renderedText, textIndexOf, walkTextNodes } from "./dom";
import type {
  BridgeChannel,
  FrameComment,
  FrameElement,
  FrameRect,
  FrameSelection,
  FrameState,
  FrameTheme,
  HostToBridge,
} from "./protocol";

void _unused;

const BLOCK_SELECTOR = "figure, table, blockquote, pre, img, video, svg, canvas";

// A document without a layout engine has no scrollIntoView to call.
function scrollInto(el: Element | null, block: ScrollLogicalPosition): void {
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block, behavior: "smooth" });
  }
}
const ID_RE = /^[A-Za-z][\w-]*$/;

type Capture = { range?: Range; el?: Element };

export function installBridge(win: Window, channel: BridgeChannel): () => void {
  const doc = win.document;
  const captures = new Map<string, Capture>();
  let captureCount = 0;
  let comments: FrameComment[] = [];
  let state: FrameState = { focused: null, hovered: null, resolved: [] };
  let disposed = false;

  // ── decoration ──────────────────────────────────────────────────────

  const passageIds = () => new Set(comments.filter((c) => c.kind === "passage").map((c) => c.id));

  const decorate = () => {
    decorateAnchors(doc, passageIds());
    for (const c of comments) {
      if (c.kind === "passage" && c.text) decoratePassage(doc, c.id, c.text);
    }
    applyAnchorState(doc, state.focused, state.hovered, new Set(state.resolved));
  };

  const style = doc.createElement("style");
  style.setAttribute("data-forgemark", "anchors");
  const applyTheme = (theme: FrameTheme) => {
    doc.documentElement.setAttribute("data-theme", theme.name);
    style.textContent = theme.stylesheet;
    if (!style.isConnected) (doc.head ?? doc.documentElement).appendChild(style);
  };

  // ── block buttons ───────────────────────────────────────────────────

  const buttons = new Map<Element, HTMLButtonElement>();

  const isHidden = (el: Element): boolean => {
    try {
      const s = win.getComputedStyle(el);
      return s.display === "none" || s.visibility === "hidden";
    } catch {
      return false;
    }
  };

  // Document coordinates of a viewport rectangle, in the space the
  // buttons are positioned in.
  const offsetBase = (): { left: number; top: number } => {
    const body = doc.body;
    if (!body) return { left: 0, top: 0 };
    try {
      if (win.getComputedStyle(body).position !== "static") {
        const r = body.getBoundingClientRect();
        return { left: r.left, top: r.top };
      }
    } catch {
      /* fall through */
    }
    return { left: -win.scrollX, top: -win.scrollY };
  };

  const refreshBlocks = () => {
    const body = doc.body;
    if (!body) return;
    const all = Array.from(doc.querySelectorAll(BLOCK_SELECTOR)).filter(
      (el) => !el.closest("[data-forgemark]"),
    );
    // Outermost: a figure wrapping a chart is the unit a reviewer means.
    const outermost = all.filter((el) => !el.parentElement?.closest(BLOCK_SELECTOR));
    const live = new Set<Element>();
    const base = offsetBase();
    const width = doc.documentElement.clientWidth || win.innerWidth;
    for (const el of outermost) {
      if (isHidden(el)) continue;
      let rect: DOMRect;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (rect.width === 0 && rect.height === 0 && typeof win.getComputedStyle === "function") {
        // No layout at all (a document without a renderer): still offer
        // the button, at the origin.
      }
      live.add(el);
      let button = buttons.get(el);
      if (!button) {
        button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("data-forgemark", "block");
        button.textContent = "Comment";
        button.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          sendElementCapture(el);
        });
        body.appendChild(button);
        buttons.set(el, button);
      }
      const label = describeElement(el);
      button.title = `Comment on ${label}`;
      button.setAttribute("aria-label", `Comment on ${label}`);
      // In the margin beside the block when there is one, on its corner
      // when there is not.
      const inMargin = rect.right + 96 <= width;
      const left = inMargin ? rect.right + 10 : Math.max(0, rect.right - 6 - 72);
      button.style.left = `${left - base.left}px`;
      button.style.top = `${rect.top + 6 - base.top}px`;
    }
    for (const [el, button] of buttons) {
      if (!live.has(el)) {
        button.remove();
        buttons.delete(el);
      }
    }
  };

  // ── captures ────────────────────────────────────────────────────────

  const frameRect = (
    r: DOMRect | { left: number; top: number; right: number; bottom: number },
  ) => ({
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
  });

  const containerIds = (node: Node | null): string[] => {
    const out: string[] = [];
    let el: Element | null = node
      ? node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      : null;
    while (el && el !== doc.documentElement) {
      const id = el.getAttribute("id");
      if (id && ID_RE.test(id) && !el.hasAttribute("data-forgemark")) out.push(id);
      el = el.parentElement;
    }
    return out;
  };

  const rectOfRange = (range: Range): FrameRect => {
    try {
      const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
      const list = rects && rects.length > 0 ? Array.from(rects) : [range.getBoundingClientRect()];
      const last = list[list.length - 1];
      const highest = list.reduce((a, b) => (b.top < a.top ? b : a), list[0]);
      return { left: last.left, top: highest.top, right: last.right, bottom: last.bottom };
    } catch {
      const el =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      try {
        return frameRect(
          el ? el.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 },
        );
      } catch {
        return { left: 0, top: 0, right: 0, bottom: 0 };
      }
    }
  };

  const overlappingAnchor = (range: Range): number | null => {
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
  };

  const anchorIdOf = (node: Node | null): number | null => {
    const el = node
      ? node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      : null;
    const raw = el?.closest("[data-anchor-id]")?.getAttribute("data-anchor-id");
    const id = raw == null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  };

  const newToken = () => `c${++captureCount}`;

  const captureSelection = (): FrameSelection | null => {
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (text.length === 0) return null;
    const nodes = walkTextNodes(doc);
    const all = nodes.map((n) => n.data).join("");
    const start = textIndexOf(doc, range.startContainer, range.startOffset);
    const end = textIndexOf(doc, range.endContainer, range.endOffset);
    const before = start == null ? "" : all.slice(Math.max(0, start - 80), start);
    const after = end == null ? "" : all.slice(end, end + 80);
    const token = newToken();
    captures.set(token, { range: range.cloneRange() });
    if (captures.size > 20) captures.delete(captures.keys().next().value as string);
    return {
      token,
      text,
      contextBefore: before.replace(/\s+/g, " ").trim(),
      contextAfter: after.replace(/\s+/g, " ").trim(),
      containerIds: containerIds(range.commonAncestorContainer),
      overlappingAnchorId: overlappingAnchor(range),
      rect: rectOfRange(range),
    };
  };

  const sendElementCapture = (el: Element) => {
    const token = newToken();
    captures.set(token, { el });
    const existing = el.closest("[data-anchor-id]");
    const existingId = existing ? Number(existing.getAttribute("data-anchor-id")) : NaN;
    const ownId = el.getAttribute("id");
    let rect: FrameRect;
    try {
      rect = frameRect(el.getBoundingClientRect());
    } catch {
      rect = { left: 0, top: 0, right: 0, bottom: 0 };
    }
    const element: FrameElement = {
      token,
      tag: el.tagName.toLowerCase(),
      description: describeElement(el),
      elementId: ownId && ID_RE.test(ownId) ? ownId : null,
      containerIds: containerIds(el.parentElement),
      textHead: renderedText(el).replace(/\s+/g, " ").trim().slice(0, 60),
      existingAnchorId: Number.isFinite(existingId) ? existingId : null,
      rect,
    };
    channel.send({ type: "elementCapture", element });
  };

  // ── selection watching ──────────────────────────────────────────────

  let lastSelectionKey = "";
  let lastCaretAnchor: number | null = null;
  const reportSelection = () => {
    if (disposed) return;
    const selection = doc.getSelection();
    // Clicking an anchored passage should focus its card. The click
    // moves the caret, and the caret is what is read here. This only
    // ever sets a focus, never clears one.
    const caretAnchor = anchorIdOf(selection?.anchorNode ?? null);
    if (caretAnchor == null) {
      lastCaretAnchor = null;
    } else if (caretAnchor !== lastCaretAnchor) {
      lastCaretAnchor = caretAnchor;
      channel.send({ type: "anchorClick", id: caretAnchor });
    }
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (lastSelectionKey !== "") {
        lastSelectionKey = "";
        channel.send({ type: "selection", selection: null });
      }
      return;
    }
    const range = selection.getRangeAt(0);
    const box = rectOfRange(range);
    const key = [
      range.startOffset,
      range.endOffset,
      selection.toString().length,
      Math.round(box.top),
      Math.round(box.left),
    ].join(":");
    if (key === lastSelectionKey) return;
    lastSelectionKey = key;
    channel.send({ type: "selection", selection: captureSelection() });
  };

  let remembered: Range | null = null;
  const rememberSelection = () => {
    reportSelection();
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    if (selection.toString().trim().length === 0) return;
    remembered = selection.getRangeAt(0).cloneRange();
  };

  // Where a range sits on screen. Ranges are the one thing whose layout
  // API a document may not implement, so this steps down to the
  // enclosing element rather than throwing.
  const boxesFor = (
    range: Range,
  ): { left: number; right: number; top: number; bottom: number }[] => {
    try {
      if (typeof range.getClientRects === "function") {
        const rects = range.getClientRects();
        if (rects.length > 0) return Array.from(rects);
      }
    } catch {
      /* fall through */
    }
    try {
      if (typeof range.getBoundingClientRect === "function") {
        return [range.getBoundingClientRect()];
      }
    } catch {
      /* fall through */
    }
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    try {
      return el ? [el.getBoundingClientRect()] : [];
    } catch {
      return [];
    }
  };

  const rangeContainsPoint = (range: Range, x: number, y: number): boolean =>
    boxesFor(range).some(
      (r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2,
    );

  // ── listeners ───────────────────────────────────────────────────────

  const onClick = (e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest?.("[data-forgemark]")) return;
    const link = target?.closest?.("a[href]");
    if (link) {
      // A link must never navigate the frame away from the report. A
      // fragment is followed here; everything else is the app's call.
      e.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1));
        const el =
          doc.getElementById(id) ??
          Array.from(doc.querySelectorAll("a[name]")).find((a) => a.getAttribute("name") === id) ??
          null;
        scrollInto(el, "start");
      } else {
        channel.send({ type: "link", href });
      }
      return;
    }
    channel.send({ type: "anchorClick", id: anchorIdOf(e.target as Node) });
  };
  const onMouseOver = (e: Event) => {
    const id = anchorIdOf(e.target as Node);
    if (id !== null) channel.send({ type: "anchorHover", id });
  };
  const onMouseOut = (e: Event) => {
    if (anchorIdOf(e.target as Node) !== null) channel.send({ type: "anchorHover", id: null });
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const selection = doc.getSelection();
    const live = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
    if (!live) {
      // Put the reader's selection back, but only when they right-clicked
      // on it; a right-click into a frame that does not hold focus can
      // collapse the selection first.
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
    reportSelection();
    channel.send({ type: "contextmenu", x: e.clientX, y: e.clientY });
  };

  let refreshTimer: number | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer != null) return;
    refreshTimer = win.setTimeout(() => {
      refreshTimer = null;
      if (disposed) return;
      decorate();
      refreshBlocks();
    }, 60);
  };

  doc.addEventListener("click", onClick);
  doc.addEventListener("mouseover", onMouseOver);
  doc.addEventListener("mouseout", onMouseOut);
  doc.addEventListener("contextmenu", onContextMenu);
  doc.addEventListener("mouseup", rememberSelection);
  doc.addEventListener("keyup", rememberSelection);
  doc.addEventListener("selectionchange", rememberSelection);
  win.addEventListener("scroll", reportSelection, { passive: true });
  win.addEventListener("resize", scheduleRefresh);
  // The floor under the selection watcher: an engine may not deliver
  // selectionchange, and the toolbar must appear regardless.
  const poll = win.setInterval(reportSelection, 200);

  const Observer = (win as unknown as { MutationObserver?: typeof MutationObserver })
    .MutationObserver;
  const observer = Observer
    ? new Observer((records: MutationRecord[]) => {
        // Our own decoration and buttons change the tree too.
        if (records.every((r) => isOurs(r.target))) return;
        scheduleRefresh();
      })
    : null;
  const isOurs = (node: Node): boolean => {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !!el?.closest?.("[data-forgemark], [data-anchor-id]");
  };
  observer?.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

  // ── messages from the app ───────────────────────────────────────────

  const wrap = (token: string, id: number) => {
    const capture = captures.get(token);
    if (!capture) return;
    const open = doc.createComment(` fmc:${id} `);
    const close = doc.createComment(` /fmc:${id} `);
    if (capture.el) {
      const el = capture.el;
      el.parentNode?.insertBefore(open, el);
      el.parentNode?.insertBefore(close, el.nextSibling);
    } else if (capture.range) {
      const range = capture.range;
      const end = range.cloneRange();
      end.collapse(false);
      end.insertNode(close);
      const start = range.cloneRange();
      start.collapse(true);
      start.insertNode(open);
    }
    captures.delete(token);
    decorate();
    refreshBlocks();
    // What the reader has selected now overlaps an anchor it did not
    // before; report it afresh.
    lastSelectionKey = "";
    reportSelection();
  };

  const onMessage = (message: HostToBridge) => {
    if (disposed) return;
    switch (message.type) {
      case "init":
        applyTheme(message.theme);
        state = message.state;
        comments = message.comments;
        decorate();
        refreshBlocks();
        break;
      case "theme":
        applyTheme(message.theme);
        break;
      case "state":
        state = message.state;
        applyAnchorState(doc, state.focused, state.hovered, new Set(state.resolved));
        break;
      case "comments":
        comments = message.comments;
        decorate();
        break;
      case "wrap":
        wrap(message.token, message.id);
        break;
      case "unwrap":
        removeAnchor(doc, message.id);
        lastSelectionKey = "";
        reportSelection();
        break;
      case "scrollTo":
        scrollInto(
          anchorElement(doc, message.id) ??
            doc.querySelector(`[data-fm-passage-host="${message.id}"]`),
          "center",
        );
        break;
      case "scrollToFragment":
        scrollInto(doc.getElementById(message.id), "start");
        break;
    }
  };
  const offMessage = channel.onMessage(onMessage);

  channel.send({ type: "ready" });
  void markerPair;

  return () => {
    disposed = true;
    offMessage();
    win.clearInterval(poll);
    if (refreshTimer != null) win.clearTimeout(refreshTimer);
    observer?.disconnect();
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("mouseover", onMouseOver);
    doc.removeEventListener("mouseout", onMouseOut);
    doc.removeEventListener("contextmenu", onContextMenu);
    doc.removeEventListener("mouseup", rememberSelection);
    doc.removeEventListener("keyup", rememberSelection);
    doc.removeEventListener("selectionchange", rememberSelection);
    win.removeEventListener("scroll", reportSelection);
    win.removeEventListener("resize", scheduleRefresh);
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    style.remove();
  };
}

// A channel over postMessage to the window that holds the frame. Only
// that window is listened to.
export function parentChannel(win: Window): BridgeChannel {
  return {
    send(message) {
      win.parent.postMessage(message, "*");
    },
    onMessage(listener) {
      const handler = (e: MessageEvent) => {
        if (e.source !== win.parent) return;
        if (!e.data || typeof e.data !== "object" || typeof e.data.type !== "string") return;
        listener(e.data as HostToBridge);
      };
      win.addEventListener("message", handler);
      return () => win.removeEventListener("message", handler);
    },
  };
}
