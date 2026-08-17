// Reviewing an HTML report, end to end.
//
// Loads a report, selects a passage in the frame, comments on it, and
// checks the bytes that would be written to disk. The assertion that
// matters most is the last one in each case: the file still round-trips,
// so nothing about adding a comment rewrote the report.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { DocumentBindings } from "../../src/state/DocumentBindings";
import { AppShell } from "../../src/components/AppShell";
import { parseForgemarkFile, serializeForgemarkFile } from "../../src/format";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

const REPORT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Modelling meals</title>
<style>p{color:#0b0b0b}</style></head>
<body>
<p>Eliminating the linear block analytically is <b>variable projection</b>
(Golub &amp; Pereyra, 1973).</p>
<figure id="fig-1"><figcaption>Figure 1. Control holds</figcaption><svg viewBox="0 0 10 10"></svg></figure>
<p>Trailing prose.</p>
</body></html>
`;

function Harness() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="probe-format">{state.format}</span>
      <span data-testid="probe-count">{state.comments.length}</span>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-anchor-text">{state.comments[0]?.anchor_text ?? ""}</span>
      <span data-testid="probe-anchor-kind">{state.comments[0]?.anchor_kind ?? ""}</span>
      <span data-testid="probe-anchor-selector">{state.comments[0]?.anchor_selector ?? ""}</span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/report.html",
            fileName: "report.html",
            text: REPORT,
            body: REPORT,
            comments: [],
            readOnly: false,
            format: "html",
          })
        }
      />
    </div>
  );
}

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <DocumentBindings />
        <Harness />
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

function frameDoc(): Document {
  const frame = document.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']");
  if (!frame?.contentDocument) throw new Error("frame not ready");
  return frame.contentDocument;
}

// Put a real selection across a phrase in the report, the way a reader
// would with the mouse.
function selectPhrase(phrase: string) {
  const doc = frameDoc();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const at = node.data.indexOf(phrase);
    if (at < 0) continue;
    const range = doc.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + phrase.length);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  throw new Error(`phrase not found in frame: ${phrase}`);
}

async function loadReport() {
  renderApp();
  fireEvent.click(screen.getByTestId("probe-load"));
  await waitFor(() => expect(screen.getByTestId("probe-format").textContent).toBe("html"));
  await waitFor(() => expect(frameDoc().querySelector("figure")).not.toBeNull());
}

const body = () => screen.getByTestId("probe-body").textContent ?? "";

describe("reviewing an HTML report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says the report is review-only", async () => {
    await loadReport();
    expect(screen.getByTestId("fm-html-chip").textContent).toContain("review only");
  });

  it("anchors a comment on a selected passage without rewriting the file", async () => {
    await loadReport();
    selectPhrase("variable projection");
    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });

    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), {
      target: { value: "Worth a one-line gloss." },
    });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));
    const next = body();
    expect(next).toContain("<!-- fmc:1 -->variable projection<!-- /fmc:1 -->");
    expect(screen.getByTestId("probe-anchor-text").textContent).toBe("variable projection");
    // Only the two markers were added — everything else is byte-identical.
    expect(next.replace("<!-- fmc:1 -->", "").replace("<!-- /fmc:1 -->", "")).toBe(REPORT);
  });

  it("produces a file that parses and re-serializes unchanged", async () => {
    await loadReport();
    selectPhrase("variable projection");
    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });
    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), {
      target: { value: "Gloss this." },
    });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));

    const parsed = parseForgemarkFile(body(), { format: "html" });
    const file = serializeForgemarkFile({
      body: parsed.body,
      comments: [
        {
          id: 1,
          anchor_text: "variable projection",
          author: "Reviewer",
          timestamp: "2026-08-16T09:00:00Z",
          resolved: false,
          body: "Gloss this.",
        },
      ],
    });
    expect(serializeForgemarkFile(parseForgemarkFile(file, { format: "html" }))).toBe(file);
  });

  it("anchors a whole figure, captioned and with its id kept as a hint", async () => {
    await loadReport();
    const doc = frameDoc();
    const figure = doc.querySelector("figure")!;
    // Hovering a block raises the affordance; clicking it opens the
    // composer. This is the only way to comment on a chart, which has no
    // text to select.
    figure.dispatchEvent(new doc.defaultView!.MouseEvent("mouseover", { bubbles: true }));
    const button = doc.querySelector<HTMLElement>(".fm-element-target")!;
    expect(button.getAttribute("data-visible")).toBe("true");
    button.dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), {
      target: { value: "Axis label is cut off." },
    });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));
    expect(screen.getByTestId("probe-anchor-kind").textContent).toBe("element");
    expect(screen.getByTestId("probe-anchor-text").textContent).toBe("Figure 1. Control holds");
    expect(screen.getByTestId("probe-anchor-selector").textContent).toBe("#fig-1");
    expect(body()).toContain('<!-- fmc:1 --><figure id="fig-1">');
    expect(body()).toContain("</figure><!-- /fmc:1 -->");
  });

  it("offers a suggestion on plain prose", async () => {
    await loadReport();
    selectPhrase("variable projection");
    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });
    await waitFor(() => expect(screen.getByTestId("fm-composer-suggest-toggle")).toBeTruthy());
  });

  it("refuses a suggestion when the passage spans markup", async () => {
    await loadReport();
    // This selection runs from prose into <b>…</b>, so the source between
    // the markers would be markup, and accepting a suggestion would mean
    // replacing tags with a sentence.
    const doc = frameDoc();
    const paragraph = doc.querySelector("p")!;
    const range = doc.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.querySelector("b")!.firstChild!, 8);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("fm-composer-suggest-unavailable").textContent).toContain(
        "spans markup",
      ),
    );
    expect(screen.queryByTestId("fm-composer-suggest-toggle")).toBeNull();
  });

  it("offers a reply instead of an overlapping anchor", async () => {
    await loadReport();
    selectPhrase("variable projection");
    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });
    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), { target: { value: "First." } });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));

    // Selecting the same passage again must not write a second marker
    // pair over the first — the format can't represent that.
    await waitFor(() => expect(frameDoc().querySelector("[data-anchor-id='1']")).not.toBeNull());
    selectPhrase("variable projection");
    fireEvent.keyDown(window, { key: "m", metaKey: true, altKey: true });
    await waitFor(() => expect(screen.getByTestId("fm-overlap-prompt")).toBeTruthy());
    expect(screen.getByTestId("probe-count").textContent).toBe("1");
  });
});
