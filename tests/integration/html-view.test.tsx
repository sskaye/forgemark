// The report frame, end to end.
//
// Covers the two claims that matter for reading an HTML report: the file
// is rendered verbatim (nothing re-serializes it), and its anchors
// become live, clickable highlights inside the frame.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { HtmlView, type HtmlViewHandle } from "../../src/components/HtmlView";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import type { Comment } from "../../src/format/types";

const REPORT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Modelling meals</title>
<style>:root{--ink:#0b0b0b}p{color:var(--ink)}</style></head>
<body>
<p>Minimising over the rest is <b><!-- fmc:1 -->variable projection<!-- /fmc:1 --></b>.</p>
<!-- fmc:2 --><figure><figcaption>Figure 1. Control holds</figcaption><svg viewBox="0 0 10 10"></svg></figure><!-- /fmc:2 -->
<p>Trailing prose.</p>
</body></html>`;

const COMMENTS: Comment[] = [
  {
    id: 1,
    anchor_text: "variable projection",
    author: "Claude",
    timestamp: "2026-08-16T09:00:00Z",
    resolved: false,
    body: "Gloss this.",
  },
  {
    id: 2,
    anchor_text: "Figure 1. Control holds",
    anchor_kind: "element",
    author: "Sam",
    timestamp: "2026-08-16T09:05:00Z",
    resolved: true,
    body: "Axis label is cut off.",
  },
];

function Harness(props: {
  body?: string;
  onAnchorClick?: (id: number | null) => void;
  onRequestElementComment?: (capture: unknown) => void;
  handleOut?: (h: HtmlViewHandle | null) => void;
}) {
  const ref = useRef<HtmlViewHandle | null>(null);
  return (
    <ThemeProvider initialPreference="light">
      <main className="fm-editor-pane">
        <HtmlView
          body={props.body ?? REPORT}
          comments={COMMENTS}
          focusedCommentId={1}
          hoveredCommentId={null}
          onAnchorClick={props.onAnchorClick ?? (() => {})}
          onAnchorHover={() => {}}
          onRequestElementComment={props.onRequestElementComment ?? (() => {})}
          handleRef={ref}
        />
      </main>
    </ThemeProvider>
  );
}

function frameDoc(container: HTMLElement): Document {
  const frame = container.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']");
  if (!frame?.contentDocument) throw new Error("frame not ready");
  return frame.contentDocument;
}

describe("HtmlView", () => {
  beforeEach(() => cleanup());

  it("renders the report's own markup and stylesheet untouched", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
    const doc = frameDoc(container);
    // The report's <style> survives — this is the thing an editor model
    // would have thrown away.
    expect(doc.querySelector("style")?.textContent).toContain("--ink:#0b0b0b");
    expect(doc.querySelector("svg")).not.toBeNull();
    expect(doc.title).toBe("Modelling meals");
  });

  it("never runs the report's own scripts", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(frameDoc(container).querySelector("body")).not.toBeNull());
    const frame = container.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']")!;
    // The sandbox pairing is the whole safety story: same-origin so the
    // host can decorate, no allow-scripts so the report can't act.
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("turns inline markers into highlighted spans", async () => {
    const { container } = render(<Harness />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("[data-anchor-id='1']")).not.toBeNull(),
    );
    const span = frameDoc(container).querySelector("[data-anchor-id='1']")!;
    expect(span.textContent).toBe("variable projection");
    expect(span.classList.contains("is-focused")).toBe(true);
  });

  it("marks a figure as an element anchor and shows it as resolved", async () => {
    const { container } = render(<Harness />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("figure[data-anchor-id='2']")).not.toBeNull(),
    );
    const figure = frameDoc(container).querySelector("figure[data-anchor-id='2']")!;
    expect(figure.classList.contains("is-resolved")).toBe(true);
  });

  it("injects its own stylesheet without disturbing the report's", async () => {
    const { container } = render(<Harness />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("style[data-forgemark='anchors']")).not.toBeNull(),
    );
    const styles = frameDoc(container).querySelectorAll("style");
    expect(styles).toHaveLength(2);
  });

  it("puts a comment button on every block, in the host document", async () => {
    // The button used to be injected into the frame and reached by a
    // click delivered to a host-attached listener inside it. WKWebView
    // does not deliver those, so it was silently dead on macOS. Out here
    // it is an ordinary part of the app.
    const { container } = render(<Harness />);
    await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
    const buttons = await screen.findAllByTestId("fm-block-comment");
    expect(buttons.length).toBeGreaterThan(0);
    // Host document, not the frame's.
    expect(buttons[0].ownerDocument).toBe(document);
    expect(frameDoc(container).querySelector("[data-testid='fm-block-comment']")).toBeNull();
    expect(buttons.some((b) => b.getAttribute("aria-label")?.includes("Figure 1"))).toBe(true);
  });

  it("offers the figure, not the chart nested inside it", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(frameDoc(container).querySelector("svg")).not.toBeNull());
    const labels = (await screen.findAllByTestId("fm-block-comment")).map((b) =>
      b.getAttribute("aria-label"),
    );
    // One button for the figure; the <svg> inside it is not a second one.
    expect(labels.filter((l) => l?.includes("Figure 1"))).toHaveLength(1);
  });

  it("raises an element capture when a block button is clicked", async () => {
    const onElement = vi.fn();
    const { container } = render(<Harness onRequestElementComment={onElement} />);
    await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
    const figureButton = (await screen.findAllByTestId("fm-block-comment")).find((b) =>
      b.getAttribute("aria-label")?.includes("Figure 1"),
    )!;
    fireEvent.click(figureButton);
    await waitFor(() => expect(onElement).toHaveBeenCalled());
    const capture = onElement.mock.calls[0][0];
    expect(capture.kind).toBe("element");
    expect(capture.text).toBe("Figure 1. Control holds");
  });

  // A report fills its frame edge to edge, so a button at a block's corner
  // lands on its caption. The pane is normally much wider than the
  // document, so the buttons go beside it — but not every window is wide
  // enough, and then they have to come back inside.
  //
  // jsdom has no layout, so the geometry is stated rather than measured.
  function withGeometry(paneRight: number, frameRight: number) {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList?.contains("fm-editor-pane")) {
        return {
          right: paneRight,
          left: 0,
          top: 0,
          bottom: 0,
          width: paneRight,
          height: 0,
        } as DOMRect;
      }
      if (this.classList?.contains("fm-html-view")) {
        return {
          right: frameRight,
          left: 0,
          top: 0,
          bottom: 0,
          width: frameRight,
          height: 0,
        } as DOMRect;
      }
      return original.call(this);
    };
    return () => {
      Element.prototype.getBoundingClientRect = original;
    };
  }

  it("puts the block buttons in the margin when the pane is wide enough", async () => {
    const restore = withGeometry(1150, 890); // ~260px of margin
    try {
      const { container } = render(<Harness />);
      await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
      const button = (await screen.findAllByTestId("fm-block-comment"))[0];
      expect(button.getAttribute("data-placement")).toBe("gutter");
    } finally {
      restore();
    }
  });

  it("brings them back onto the block when there is no margin", async () => {
    const restore = withGeometry(660, 612); // 48px, not enough
    try {
      const { container } = render(<Harness />);
      await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
      const button = (await screen.findAllByTestId("fm-block-comment"))[0];
      expect(button.getAttribute("data-placement")).toBe("inset");
    } finally {
      restore();
    }
  });

  it("reports which comment was clicked", async () => {
    const onAnchorClick = vi.fn();
    const { container } = render(<Harness onAnchorClick={onAnchorClick} />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("[data-anchor-id='1']")).not.toBeNull(),
    );
    const doc = frameDoc(container);
    const span = doc.querySelector("[data-anchor-id='1']")! as HTMLElement;
    span.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true }));
    await waitFor(() => expect(onAnchorClick).toHaveBeenCalledWith(1));
  });

  it("clears the focused comment when the reader clicks elsewhere", async () => {
    const onAnchorClick = vi.fn();
    const { container } = render(<Harness onAnchorClick={onAnchorClick} />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("[data-anchor-id='1']")).not.toBeNull(),
    );
    const doc = frameDoc(container);
    const paragraphs = doc.querySelectorAll("p");
    const last = paragraphs[paragraphs.length - 1] as HTMLElement;
    last.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true }));
    await waitFor(() => expect(onAnchorClick).toHaveBeenCalledWith(null));
  });
});
