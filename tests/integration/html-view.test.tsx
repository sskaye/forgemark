// The report frame, end to end.
//
// Covers the two claims that matter for reading an HTML report: the file
// is rendered verbatim (nothing re-serializes it), and its anchors
// become live, clickable highlights inside the frame.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { HtmlView, type HtmlViewHandle } from "../../src/components/HtmlView";
import { fakeTauri } from "../utils/harness";
import { lastReportLoad } from "../utils/reportFrame";
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
  baseDir?: string | null;
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
          baseDir={props.baseDir}
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

  it("runs the report's scripts, on the report's own origin", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(frameDoc(container).querySelector("body")).not.toBeNull());
    const frame = container.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']")!;
    // Scripts run; same-origin is the report's own origin, which the
    // loader gives it, not the app's.
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(lastReportLoad?.html).toContain('<script data-forgemark="bridge">');
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

  it("puts a comment button beside every block, inside the frame", async () => {
    const { container } = render(<Harness />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("button[data-forgemark='block']")).not.toBeNull(),
    );
    const labels = Array.from(
      frameDoc(container).querySelectorAll("button[data-forgemark='block']"),
    ).map((b) => b.getAttribute("aria-label"));
    // One button for the figure; the <svg> inside it is not a second one.
    expect(labels.filter((l) => l?.includes("Figure 1"))).toHaveLength(1);
  });

  it("raises an element capture when a block button is clicked", async () => {
    const onElement = vi.fn();
    const { container } = render(<Harness onRequestElementComment={onElement} />);
    await waitFor(() =>
      expect(frameDoc(container).querySelector("button[data-forgemark='block']")).not.toBeNull(),
    );
    frameDoc(container).querySelector<HTMLButtonElement>("button[data-forgemark='block']")!.click();
    await waitFor(() => expect(onElement).toHaveBeenCalled());
    const capture = onElement.mock.calls[0][0];
    expect(capture.kind).toBe("element");
    expect(capture.text).toBe("Figure 1. Control holds");
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

describe("HtmlView relative references and links", () => {
  beforeEach(() => cleanup());

  it("tells the loader which folder the report is in", async () => {
    const { container } = render(<Harness baseDir="/reports" />);
    await waitFor(() => expect(frameDoc(container).querySelector("figure")).not.toBeNull());
    expect(lastReportLoad?.baseDir).toBe("/reports");
  });

  it("opens an address outside, another document in a tab, and scrolls to a fragment", async () => {
    const body =
      '<html><head></head><body><h2 id="sec">Sec</h2><p><a href="https://x.y/p">out</a> <a href="other.md">doc</a> <a href="#sec">frag</a></p></body></html>';
    const { container } = render(<Harness body={body} baseDir="/reports" />);
    await waitFor(() => expect(frameDoc(container).querySelector("a")).toBeTruthy());
    const doc = frameDoc(container);
    const opened = vi.fn();
    window.addEventListener("forgemark:open-path", opened as (e: Event) => void);

    (doc.querySelector("a[href='https://x.y/p']") as HTMLElement).click();
    await waitFor(() => expect(fakeTauri.opener.openUrl).toHaveBeenCalledWith("https://x.y/p"));

    (doc.querySelector("a[href='other.md']") as HTMLElement).click();
    await waitFor(() => expect(opened).toHaveBeenCalled());
    window.removeEventListener("forgemark:open-path", opened as (e: Event) => void);
    expect((opened.mock.calls[0][0] as CustomEvent).detail.path).toBe("/reports/other.md");

    // A fragment is followed inside the frame, which scrolls itself.
    const target = doc.getElementById("sec") as HTMLElement;
    target.scrollIntoView = vi.fn();
    (doc.querySelector("a[href='#sec']") as HTMLElement).click();
    expect(target.scrollIntoView).toHaveBeenCalled();
  });
});
