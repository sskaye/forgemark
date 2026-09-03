// Right-click inside a report.
//
// The report lives in an iframe, and that breaks two assumptions the
// context menu was built on: its events never reach the host window, and
// right-clicking it moves focus into the frame's browsing context — which
// fires `blur` on the top-level window, the very signal the menu uses to
// decide the app has been left.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(() => Promise.resolve()),
  lstat: vi.fn(() => Promise.resolve({ isSymlink: false })),
  remove: vi.fn(() => Promise.resolve()),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

const REPORT = `<!doctype html>
<html><head><title>Meals</title></head>
<body>
<p>Eliminating the linear block analytically is <b>variable projection</b>.</p>
</body></html>
`;

function Harness() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="probe-format">{state.format}</span>
      <span data-testid="probe-composer">{state.composer?.mode ?? "none"}</span>
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

function frame(): HTMLIFrameElement {
  const el = document.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']");
  if (!el?.contentDocument) throw new Error("frame not ready");
  return el;
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
  await waitFor(() => expect(frame().contentDocument!.querySelector("b")).not.toBeNull());
}

function selectPhrase(phrase: string) {
  const doc = frame().contentDocument!;
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

// Right-click the report the way a reader does: the event fires inside the
// frame, and focus lands on the frame element.
function rightClickInFrame() {
  const el = frame();
  const doc = el.contentDocument!;
  doc.dispatchEvent(
    new doc.defaultView!.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 }),
  );
  el.focus();
  fireEvent.blur(window);
}

describe("right-clicking a report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the New Comment / Suggest Edit menu", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    expect(screen.getByTestId("fm-context-new-comment")).toBeTruthy();
    expect(screen.getByTestId("fm-context-suggest-edit")).toBeTruthy();
  });

  it("survives the window blur that focusing the frame causes", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    // A second blur, as the frame keeps focus, must not close it either.
    fireEvent.blur(window);
    expect(screen.queryByTestId("fm-context-menu")).not.toBeNull();
  });

  it("still closes when the app itself loses focus", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    // Focus leaves the frame for something outside the app.
    frame().blur();
    (document.body as HTMLElement).focus();
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByTestId("fm-context-menu")).toBeNull());
  });

  it("opens the composer from the menu", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    fireEvent.click(screen.getByTestId("fm-context-new-comment"));
    await waitFor(() => expect(screen.getByTestId("probe-composer").textContent).toBe("new"));
  });

  it("opens the composer in suggest mode from the menu", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    fireEvent.click(screen.getByTestId("fm-context-suggest-edit"));
    await waitFor(() => expect(screen.getByTestId("fm-composer-replacement")).toBeTruthy());
  });

  it("opens even when the right-click collapsed the selection first", async () => {
    // Right-clicking a frame that doesn't already hold focus focuses it,
    // and focusing a browsing context can collapse its selection — so the
    // passage is gone by the time `contextmenu` fires. The reader's
    // gesture was still unambiguous, so the menu has to open anyway.
    await loadReport();
    selectPhrase("variable projection");
    const doc = frame().contentDocument!;
    // `mouseup` is what records the selection, as a real drag would.
    doc.dispatchEvent(new doc.defaultView!.MouseEvent("mouseup", { bubbles: true }));
    doc.getSelection()!.removeAllRanges();

    // jsdom reports a zero rect for the enclosing element, so a click at
    // the origin counts as "on the passage" and one far away does not.
    doc.dispatchEvent(
      new doc.defaultView!.MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 }),
    );
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    // And the selection is put back, so the composer anchors correctly.
    expect(doc.getSelection()!.toString()).toBe("variable projection");
  });

  it("does not resurrect a selection the reader right-clicked away from", async () => {
    await loadReport();
    selectPhrase("variable projection");
    const doc = frame().contentDocument!;
    doc.dispatchEvent(new doc.defaultView!.MouseEvent("mouseup", { bubbles: true }));
    doc.getSelection()!.removeAllRanges();
    doc.dispatchEvent(
      new doc.defaultView!.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 9000,
        clientY: 9000,
      }),
    );
    expect(screen.queryByTestId("fm-context-menu")).toBeNull();
    expect(doc.getSelection()!.toString()).toBe("");
  });

  it("does nothing when there is no selection", async () => {
    await loadReport();
    frame().contentDocument!.getSelection()!.removeAllRanges();
    rightClickInFrame();
    expect(screen.queryByTestId("fm-context-menu")).toBeNull();
  });

  it("closes when the reader clicks elsewhere in the report", async () => {
    await loadReport();
    selectPhrase("variable projection");
    rightClickInFrame();
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    const doc = frame().contentDocument!;
    doc
      .querySelector("p")!
      .dispatchEvent(new doc.defaultView!.MouseEvent("click", { bubbles: true }));
    await waitFor(() => expect(screen.queryByTestId("fm-context-menu")).toBeNull());
  });
});
