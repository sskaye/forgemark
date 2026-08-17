// The selection toolbar.
//
// Right-click inside a report belongs to the embedder — WKWebView answers
// it with its own Look Up / Translate / Copy menu, and a `contextmenu`
// listener the host attached inside the frame does not reliably get to
// suppress it. So the primary way to comment on a passage cannot depend
// on that event, or on any event raised inside the frame. It depends only
// on reading the selection across the boundary, which is the same
// capability ⌘⌥M has always used.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

const REPORT = `<!doctype html>
<html><head><title>Meals</title></head>
<body>
<p>Eliminating the linear block analytically is <b>variable projection</b>.</p>
<figure id="fig-1"><figcaption>Figure 1. Control holds</figcaption><svg viewBox="0 0 10 10"></svg></figure>
</body></html>
`;

function Harness() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="probe-format">{state.format}</span>
      <span data-testid="probe-composer">{state.composer?.mode ?? "none"}</span>
      <span data-testid="probe-count">{state.comments.length}</span>
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

function frameDoc(): Document {
  const el = document.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']");
  if (!el?.contentDocument) throw new Error("frame not ready");
  return el.contentDocument;
}

async function loadReport() {
  render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <Harness />
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("probe-load"));
  await waitFor(() => expect(screen.getByTestId("probe-format").textContent).toBe("html"));
  await waitFor(() => expect(frameDoc().querySelector("b")).not.toBeNull());
}

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
  throw new Error(`phrase not found: ${phrase}`);
}

function clearSelection() {
  frameDoc().getSelection()!.removeAllRanges();
}

// The watcher polls; advance past one tick. Deliberately not driven by any
// event inside the frame — that is the whole point.
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe("selection toolbar in a report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("appears when the reader selects a passage, with no frame event involved", async () => {
    await loadReport();
    expect(screen.queryByTestId("fm-selection-toolbar")).toBeNull();
    selectPhrase("variable projection");
    await settle();
    await waitFor(() => expect(screen.getByTestId("fm-selection-toolbar")).toBeTruthy());
    expect(screen.getByTestId("fm-selection-comment")).toBeTruthy();
    expect(screen.getByTestId("fm-selection-suggest")).toBeTruthy();
  });

  it("goes away when the selection is dropped", async () => {
    await loadReport();
    selectPhrase("variable projection");
    await settle();
    await waitFor(() => expect(screen.getByTestId("fm-selection-toolbar")).toBeTruthy());
    clearSelection();
    await settle();
    await waitFor(() => expect(screen.queryByTestId("fm-selection-toolbar")).toBeNull());
  });

  it("opens the composer anchored to the selection", async () => {
    await loadReport();
    selectPhrase("variable projection");
    await settle();
    await waitFor(() => expect(screen.getByTestId("fm-selection-toolbar")).toBeTruthy());
    fireEvent.click(screen.getByTestId("fm-selection-comment"));

    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), {
      target: { value: "Gloss this." },
    });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));
  });

  it("opens straight into suggest mode from the second button", async () => {
    await loadReport();
    selectPhrase("variable projection");
    await settle();
    await waitFor(() => expect(screen.getByTestId("fm-selection-toolbar")).toBeTruthy());
    fireEvent.click(screen.getByTestId("fm-selection-suggest"));
    await waitFor(() => expect(screen.getByTestId("fm-composer-replacement")).toBeTruthy());
  });

  it("stands down while the composer is open", async () => {
    await loadReport();
    selectPhrase("variable projection");
    await settle();
    fireEvent.click(await screen.findByTestId("fm-selection-comment"));
    await waitFor(() => expect(screen.getByTestId("probe-composer").textContent).toBe("new"));
    expect(screen.queryByTestId("fm-selection-toolbar")).toBeNull();
  });

  it("offers no suggestion when the passage spans markup", async () => {
    await loadReport();
    const doc = frameDoc();
    const paragraph = doc.querySelector("p")!;
    const range = doc.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.querySelector("b")!.firstChild!, 8);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await settle();
    await waitFor(() => expect(screen.getByTestId("fm-selection-toolbar")).toBeTruthy());
    expect(screen.queryByTestId("fm-selection-suggest")).toBeNull();
  });

  it("does not appear for a Markdown document", async () => {
    render(
      <ThemeProvider initialPreference="light">
        <DocumentProvider>
          <Harness />
          <AppShell />
        </DocumentProvider>
      </ThemeProvider>,
    );
    await settle();
    expect(screen.queryByTestId("fm-selection-toolbar")).toBeNull();
  });
});
