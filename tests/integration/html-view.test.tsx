// The report frame, end to end.
//
// Covers the two claims that matter for reading an HTML report: the file
// is rendered verbatim (nothing re-serializes it), and its anchors
// become live, clickable highlights inside the frame.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
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
          onRequestElementComment={() => {}}
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
