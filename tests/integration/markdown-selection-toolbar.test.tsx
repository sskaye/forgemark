// The selection toolbar in a Markdown document.
//
// The affordance was built for HTML reports, where right-click belongs to
// the system webview and could not be taken. Markdown has no such
// constraint — its right-click menu works and still does — but a reader
// shouldn't have to learn two ways to comment depending on which kind of
// file is open, so both documents behave the same way.
//
// Unlike the report frame, this side needs no polling: ProseMirror
// announces selection changes directly.

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

const BODY = "Some prose with `inline code` and anchored words here.\n";

function Harness() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="probe-composer">{state.composer?.mode ?? "none"}</span>
      <span data-testid="probe-count">{state.comments.length}</span>
      <span data-testid="probe-anchor">{state.comments[0]?.anchor_text ?? ""}</span>
      <span data-testid="probe-kind">{state.comments[0]?.anchor_kind ?? "text"}</span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/notes.md",
            fileName: "notes.md",
            text: BODY,
            body: BODY,
            comments: [],
            readOnly: false,
          })
        }
      />
    </div>
  );
}

async function loadDoc() {
  render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <Harness />
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("probe-load"));
  await waitFor(() => expect(document.querySelector(".ProseMirror p")).not.toBeNull());
}

// Select in the editor the way a drag does — through the DOM, letting
// ProseMirror observe it, rather than reaching into the view directly.
function selectText(match: string) {
  const pm = document.querySelector(".ProseMirror") as HTMLElement;
  pm.focus();
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const at = node.data.indexOf(match);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + match.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return;
  }
  throw new Error(`text not found in editor: ${match}`);
}

function collapseSelection() {
  const pm = document.querySelector(".ProseMirror") as HTMLElement;
  const first = pm.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(first, 1);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

const toolbar = () => screen.queryByTestId("fm-selection-toolbar");

describe("selection toolbar in a Markdown document", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appears when the reader selects a passage", async () => {
    await loadDoc();
    expect(toolbar()).toBeNull();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    expect(screen.getByTestId("fm-selection-comment")).toBeTruthy();
    // Markdown anchors are always plain text, so a suggestion is always
    // representable — unlike a report, where markup can get in the way.
    expect(screen.getByTestId("fm-selection-suggest")).toBeTruthy();
  });

  it("goes away when the selection collapses", async () => {
    await loadDoc();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    collapseSelection();
    await waitFor(() => expect(toolbar()).toBeNull());
  });

  it("anchors a comment through the toolbar", async () => {
    await loadDoc();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    fireEvent.click(screen.getByTestId("fm-selection-comment"));

    await waitFor(() => expect(screen.getByTestId("fm-composer-textarea")).toBeTruthy());
    fireEvent.change(screen.getByTestId("fm-composer-textarea"), {
      target: { value: "Tighten this." },
    });
    fireEvent.keyDown(screen.getByTestId("fm-composer-textarea"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-count").textContent).toBe("1"));
    expect(screen.getByTestId("probe-anchor").textContent).toBe("Some prose");
    // A Markdown anchor is never an element anchor, whatever it wraps.
    expect(screen.getByTestId("probe-kind").textContent).toBe("text");
  });

  it("opens straight into suggest mode", async () => {
    await loadDoc();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    fireEvent.click(screen.getByTestId("fm-selection-suggest"));
    await waitFor(() => expect(screen.getByTestId("fm-composer-replacement")).toBeTruthy());
  });

  it("stands down while the composer is open", async () => {
    await loadDoc();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    fireEvent.click(screen.getByTestId("fm-selection-comment"));
    await waitFor(() => expect(screen.getByTestId("probe-composer").textContent).toBe("new"));
    expect(toolbar()).toBeNull();
  });

  it("offers nothing for a selection that can't be anchored", async () => {
    await loadDoc();
    // Wholly inside inline code: the anchoring rules refuse it, and the
    // reason belongs in a message when someone acts, not in a button that
    // is going to say no.
    selectText("inline code");
    await new Promise((r) => setTimeout(r, 50));
    expect(toolbar()).toBeNull();
  });

  it("keeps the right-click menu Markdown always had, and never shows both", async () => {
    await loadDoc();
    selectText("Some prose");
    await waitFor(() => expect(toolbar()).not.toBeNull());
    fireEvent.contextMenu(document.querySelector(".fm-rendered-view")!);
    await waitFor(() => expect(screen.getByTestId("fm-context-menu")).toBeTruthy());
    expect(toolbar()).toBeNull();
  });
});
