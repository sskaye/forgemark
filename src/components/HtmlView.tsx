import { useCallback, useEffect, useMemo, useRef } from "react";
import { insertMarkersIntoBody, removeMarkersFromBody } from "../format";
import { AnchorError, locateAnchor, locateElement, locatePassage } from "../format/locate";
import { findBySelector, findByText } from "../format/html/elements";
import type { Comment } from "../format/types";
import { anchorStylesheet } from "../report/decorate";
import { loadReport, type ReportConnection } from "../report/host";
import type {
  BridgeToHost,
  FrameComment,
  FrameElement,
  FrameRect,
  FrameSelection,
} from "../report/protocol";
import { useTheme } from "../theme/ThemeProvider";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { classifyLink } from "../services/documentLinks";
import { deliverOpenPath } from "../state/menuBridge";
import "./HtmlView.css";

// The HTML review view.
//
// The report is shown in a frame on an origin of its own, where its
// scripts run as they would in a browser and the app is out of reach
// (src/report/host.ts). Forgemark's bridge runs inside it and everything
// this component does is a message to or from that bridge
// (src/report/protocol.ts): the comments to highlight go in; the
// reader's selection, clicks, and link follows come out.
//
// The source is never re-serialized. A comment is a marker pair spliced
// into it at byte offsets, and the frame is told to put the same pair
// around the range it captured, so adding or removing a comment does not
// reload the report — a reload would run its scripts again and lose
// whatever tab or range the reader had chosen. Anything else that
// changes the source (an accepted suggestion, a reattached anchor, a
// reload from disk) reloads the frame.

export type HtmlCapturedSelection = {
  // Offsets into the *source*, ready to splice markers into.
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
  // "inline": a passage in the source. "element": a whole block.
  // "passage": text a script produced, anchored to the element that
  // holds it. "floating": nothing in the source to anchor to; the
  // comment keeps the quoted text.
  kind: "inline" | "element" | "passage" | "floating";
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
  // The frame's own name for what was captured, so the markers can be
  // put around exactly that.
  token: string;
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
  // Right-click inside the frame never reaches the host window, so the
  // frame forwards it with host-viewport coordinates.
  onContextMenu?: (at: { x: number; y: number }) => void;
  // Fires as the reader selects and deselects text in the report, so the
  // host can float a Comment / Suggest edit affordance at the selection.
  onSelectionChange?: (capture: HtmlCapturedSelection | null) => void;
  // The folder the report is in: a stylesheet, image, or link written
  // relative to the report resolves against it.
  baseDir?: string | null;
  onLinkError?: (message: string) => void;
  // Shown but not visible: the source view is in front. The frame stays
  // loaded so the report keeps its state.
  hidden?: boolean;
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
  hidden = false,
  handleRef,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const connectionRef = useRef<ReportConnection | null>(null);
  // The source the frame currently shows, kept in step by hand when a
  // comment is added or removed without a reload.
  const shownBodyRef = useRef<string | null>(null);
  const lastSelectionRef = useRef<HtmlCapturedSelection | null>(null);
  const { theme } = useTheme();

  const latest = useRef({
    body,
    baseDir,
    onAnchorClick,
    onAnchorHover,
    onRequestElementComment,
    onContextMenu,
    onSelectionChange,
    onLinkError,
  });
  latest.current = {
    body,
    baseDir,
    onAnchorClick,
    onAnchorHover,
    onRequestElementComment,
    onContextMenu,
    onSelectionChange,
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

  const frameComments = useMemo<FrameComment[]>(
    () =>
      comments
        .filter((c) => !c.floating)
        .map((c) => ({
          id: c.id,
          kind:
            c.anchor_kind === "passage"
              ? "passage"
              : c.anchor_kind === "element"
                ? "element"
                : "inline",
          ...(c.anchor_kind === "passage" ? { text: c.anchor_text ?? "" } : {}),
        })),
    [comments],
  );
  const frameState = useMemo(
    () => ({
      focused: focusedCommentId,
      hovered: hoveredCommentId,
      resolved: comments.filter((c) => c.resolved).map((c) => c.id),
    }),
    [focusedCommentId, hoveredCommentId, comments],
  );
  const latestFrame = useRef({ stylesheet, themeName: theme.name, frameComments, frameState });
  latestFrame.current = { stylesheet, themeName: theme.name, frameComments, frameState };

  // Host-viewport coordinates for a rectangle the frame reported in its
  // own, plus a little for the composer to sit under.
  const hostRect = useCallback((r: FrameRect) => {
    const f = frameRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { left: f.left + r.left, top: f.top + r.top, bottom: f.top + r.bottom };
  }, []);

  // What the reader selected, located in the source. A passage the
  // source has is anchored where it is; one a script produced is
  // anchored to the element that holds it; one with no such element is
  // a floating note that keeps the quoted text.
  const resolveSelection = useCallback(
    (s: FrameSelection): HtmlCapturedSelection => {
      const body = latest.current.body;
      const rect = hostRect(s.rect);
      const base = {
        text: s.text,
        contextBefore: s.contextBefore,
        contextAfter: s.contextAfter,
        overlappingAnchorId: s.overlappingAnchorId,
        rect,
        token: s.token,
      };
      try {
        const p = locateAnchor(body, s.text, "html", {
          near: { before: s.contextBefore, after: s.contextAfter },
        });
        return { ...base, from: p.start, to: p.end, kind: "inline" };
      } catch (err) {
        if (!(err instanceof AnchorError)) throw err;
      }
      for (const id of s.containerIds) {
        try {
          const p = locatePassage(body, `#${id}`, s.text, "html", {
            before: s.contextBefore,
            after: s.contextAfter,
          });
          return { ...base, from: p.start, to: p.end, kind: "passage", anchorSelector: `#${id}` };
        } catch (err) {
          if (!(err instanceof AnchorError)) throw err;
        }
      }
      return { ...base, from: 0, to: 0, kind: "floating" };
    },
    [hostRect],
  );

  // A block the reader asked to comment on, located in the source: by
  // its id, by its text, or by the nearest element with an id that the
  // source has.
  const resolveElement = useCallback(
    (e: FrameElement): HtmlCapturedSelection => {
      const body = latest.current.body;
      const rect = hostRect(e.rect);
      const base = {
        text: e.description,
        contextBefore: "",
        contextAfter: "",
        overlappingAnchorId: e.existingAnchorId,
        rect,
        token: e.token,
      };
      if (e.existingAnchorId != null) return { ...base, from: 0, to: 0, kind: "element" };
      const own = e.elementId ? findBySelector(body, `#${e.elementId}`) : null;
      if (own) {
        try {
          // An element the source has but whose content it does not — a
          // chart a script draws into an empty figure — is anchored as a
          // passage, so the highlight follows what it shows now, not the
          // container it will show something else in after a redraw.
          // Decided before any locating: a passage may join others on
          // the element, where a block anchor may not.
          const sourceText = own.text
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();
          const generated = e.textHead.length > 0 && !sourceText.includes(e.textHead.slice(0, 30));
          if (generated) {
            const passage = locatePassage(body, `#${e.elementId}`, e.description, "html");
            return {
              ...base,
              from: passage.start,
              to: passage.end,
              kind: "passage",
              anchorSelector: `#${e.elementId}`,
            };
          }
          const p = locateElement(body, `#${e.elementId}`, "html");
          return {
            ...base,
            from: p.start,
            to: p.end,
            kind: "element",
            anchorSelector: `#${e.elementId}`,
          };
        } catch (err) {
          if (!(err instanceof AnchorError)) throw err;
        }
      }
      const byText = e.textHead ? findByText(body, e.textHead, { preferBlock: true }) : null;
      if (byText) {
        const owner = e.containerIds[0];
        return {
          ...base,
          from: byText.start,
          to: byText.end,
          kind: "element",
          ...(owner ? { anchorSelector: `#${owner} ${e.tag}` } : {}),
        };
      }
      for (const id of e.containerIds) {
        try {
          const p = locatePassage(body, `#${id}`, e.description, "html");
          return { ...base, from: p.start, to: p.end, kind: "passage", anchorSelector: `#${id}` };
        } catch (err) {
          if (!(err instanceof AnchorError)) throw err;
        }
      }
      return {
        ...base,
        from: 0,
        to: 0,
        kind: "element",
        rejectReason: "This block can't be located in the file's source.",
      };
    },
    [hostRect],
  );

  const failed = (what: string) => (err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    latest.current.onLinkError?.(`${what} failed: ${detail}`);
  };

  const onMessage = useCallback(
    (message: BridgeToHost) => {
      const frame = frameRef.current;
      switch (message.type) {
        case "selection": {
          const capture = message.selection ? resolveSelection(message.selection) : null;
          lastSelectionRef.current = capture;
          latest.current.onSelectionChange?.(capture);
          break;
        }
        case "anchorClick":
          latest.current.onAnchorClick(message.id);
          break;
        case "anchorHover":
          latest.current.onAnchorHover(message.id);
          break;
        case "contextmenu": {
          const f = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
          latest.current.onContextMenu?.({ x: f.left + message.x, y: f.top + message.y });
          break;
        }
        case "link": {
          const target = classifyLink(message.href, latest.current.baseDir);
          if (target.kind === "external") void openUrl(target.url).catch(failed("Open link"));
          else if (target.kind === "document") deliverOpenPath(target.path);
          else if (target.kind === "file") void openPath(target.path).catch(failed("Open file"));
          else if (target.kind === "fragment")
            connectionRef.current?.send({ type: "scrollToFragment", id: target.id });
          break;
        }
        case "elementCapture":
          latest.current.onRequestElementComment(resolveElement(message.element));
          break;
        case "keydown":
          // Replayed on the app's window so its own shortcuts apply, as
          // they would with the focus anywhere else in the app.
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: message.key,
              code: message.code,
              metaKey: message.metaKey,
              ctrlKey: message.ctrlKey,
              altKey: message.altKey,
              shiftKey: message.shiftKey,
              bubbles: true,
              cancelable: true,
            }),
          );
          break;
        case "ready":
          break;
      }
    },
    [resolveElement, resolveSelection],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Load the report into the frame. Runs on mount and whenever the
  // source changed in a way the frame was not told about. One load at a
  // time: a second for the same source while the first is in flight is
  // skipped, and a load overtaken by a newer one throws its connection
  // away, or two bridges would be talking to one view.
  const loadSeq = useRef(0);
  const loadingRef = useRef<string | null>(null);
  const load = useCallback(async (html: string) => {
    const frame = frameRef.current;
    if (!frame) return;
    if (loadingRef.current === html) return;
    loadingRef.current = html;
    const seq = ++loadSeq.current;
    connectionRef.current?.dispose();
    connectionRef.current = null;
    lastSelectionRef.current = null;
    let connection: ReportConnection;
    try {
      connection = await loadReport(frame, { html, baseDir: latest.current.baseDir });
    } catch (err) {
      if (loadingRef.current === html) loadingRef.current = null;
      latest.current.onLinkError?.(
        `The report could not be shown: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (loadingRef.current === html) loadingRef.current = null;
    // A newer load may have started while this one was in flight.
    if (seq !== loadSeq.current || frameRef.current !== frame || latest.current.body !== html) {
      connection.dispose();
      return;
    }
    connectionRef.current = connection;
    shownBodyRef.current = html;
    connection.onMessage((m) => onMessageRef.current(m));
    const f = latestFrame.current;
    connection.send({
      type: "init",
      theme: { name: f.themeName, stylesheet: f.stylesheet },
      state: f.frameState,
      comments: f.frameComments,
    });
  }, []);

  // The source changed. A comment added around the last capture, or one
  // removed, is applied in the frame without a reload; anything else
  // reloads the report.
  const previousComments = useRef<Comment[]>(comments);
  useEffect(() => {
    const shown = shownBodyRef.current;
    const connection = connectionRef.current;
    const before = previousComments.current;
    previousComments.current = comments;
    if (shown === body) return;
    if (shown != null && connection) {
      const added = comments.filter((c) => !before.some((b) => b.id === c.id));
      const removed = before.filter((b) => !comments.some((c) => c.id === b.id));
      const capture = lastSelectionRef.current ?? lastElementRef.current;
      if (added.length === 1 && removed.length === 0 && capture && capture.kind !== "floating") {
        const expected = insertMarkersIntoBody(shown, capture.from, capture.to, added[0].id);
        if (expected === body) {
          // The capture is spent; the frame reports the selection again,
          // now inside an anchor, if it is still there.
          lastSelectionRef.current = null;
          lastElementRef.current = null;
          const c = added[0];
          connection.send({
            type: "wrap",
            token: capture.token,
            id: c.id,
            kind:
              c.anchor_kind === "passage"
                ? "passage"
                : c.anchor_kind === "element"
                  ? "element"
                  : "inline",
            ...(c.anchor_kind === "passage"
              ? { text: c.anchor_text ?? "", selector: c.anchor_selector }
              : {}),
          });
          connection.send({ type: "comments", comments: latestFrame.current.frameComments });
          shownBodyRef.current = body;
          return;
        }
      }
      if (removed.length === 1 && added.length === 0) {
        if (removeMarkersFromBody(shown, removed[0].id) === body) {
          connection.send({ type: "unwrap", id: removed[0].id });
          shownBodyRef.current = body;
          return;
        }
      }
      const floated = comments.find(
        (c) => c.floating && before.some((b) => b.id === c.id && !b.floating),
      );
      if (floated && removeMarkersFromBody(shown, floated.id) === body) {
        connection.send({ type: "unwrap", id: floated.id });
        shownBodyRef.current = body;
        return;
      }
    }
    void load(body);
  }, [body, comments, load]);

  useEffect(() => {
    return () => {
      connectionRef.current?.dispose();
      connectionRef.current = null;
    };
  }, []);

  useEffect(() => {
    connectionRef.current?.send({ type: "state", state: frameState });
  }, [frameState]);

  useEffect(() => {
    connectionRef.current?.send({ type: "comments", comments: frameComments });
  }, [frameComments]);

  useEffect(() => {
    connectionRef.current?.send({ type: "theme", theme: { name: theme.name, stylesheet } });
  }, [stylesheet, theme.name]);

  // The last block capture, for wrapping it when its comment arrives.
  const lastElementRef = useRef<HtmlCapturedSelection | null>(null);
  const requestElement = latest.current.onRequestElementComment;
  useEffect(() => {
    latest.current.onRequestElementComment = (capture) => {
      lastElementRef.current = capture;
      lastSelectionRef.current = null;
      requestElement(capture);
    };
  });

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      captureSelection: () => lastSelectionRef.current,
      applyAnchor: (from, to, id) => insertMarkersIntoBody(latest.current.body, from, to, id),
      selectedText: () => lastSelectionRef.current?.text ?? null,
      scrollToComment: (id: number) => connectionRef.current?.send({ type: "scrollTo", id }),
    };
    return () => {
      if (handleRef.current) handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <div className="fm-html-frame" hidden={hidden}>
      <iframe
        ref={frameRef}
        className="fm-html-view"
        data-testid="fm-html-view"
        title="Report under review"
        // The report's scripts run, on the report's own origin (see
        // src/report/host.ts). `allow-same-origin` here is that origin,
        // not the app's: the frame keeps its own storage and can load the
        // files beside the report, and can reach nothing of the app.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
