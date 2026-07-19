import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { typeIntoEditor } from "../utils/typing";

vi.mock("../../src/services/fileIO", () => ({
  openMarkdownFile: vi.fn(),
  readMarkdownFile: vi.fn(),
  saveMarkdownFile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

// Phase 4: every open document keeps a mounted editor, hidden rather than
// unmounted while it's in the background. That's what lets undo history,
// cursor, and scroll survive a tab switch — the ProseMirror history
// plugin lives inside the editor instance, so unmounting discards it.
//
// The cost is N editors listening on `window`, so their shortcuts are
// gated on isActive.

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{workspace.docs[workspace.activeId].fileName}</span>
      <button data-testid="open-tab" onClick={() => dispatch({ type: "openTab" })} />
      <button
        data-testid="activate-first"
        onClick={() => dispatch({ type: "activateTab", docId: workspace.order[0] })}
      />
      <button
        data-testid="activate-second"
        onClick={() => dispatch({ type: "activateTab", docId: workspace.order[1] })}
      />
    </div>
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const click = async (id: string) => {
  await act(async () => {
    screen.getByTestId(id).click();
  });
};

function activePane(container: HTMLElement): HTMLElement {
  const pane = container.querySelector('[data-testid="fm-editor-pane"][data-active="true"]');
  if (!pane) throw new Error("no active editor pane");
  return pane as HTMLElement;
}

// ProseMirror binds undo as Mod-z, which is Ctrl off macOS; jsdom reports
// a non-Mac platform. Fire exactly one.
function pressUndo(pane: HTMLElement) {
  const pm = pane.querySelector(".ProseMirror");
  if (!pm) throw new Error("no editor in pane");
  fireEvent.keyDown(pm, { key: "z", ctrlKey: true });
}

describe("every open document keeps a mounted editor", () => {
  it("mounts one editor per tab and shows only the active one", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1));

    await click("open-tab");

    await waitFor(() => expect(container.querySelectorAll(".ProseMirror")).toHaveLength(2));
    const panes = container.querySelectorAll('[data-testid="fm-editor-pane"]');
    expect(panes).toHaveLength(2);
    const visible = container.querySelectorAll(
      '[data-testid="fm-editor-pane"][data-active="true"]',
    );
    expect(visible).toHaveLength(1);
    // The background pane is out of the layout and hidden from assistive
    // tech, but still in the tree.
    const hidden = container.querySelector('[data-testid="fm-editor-pane"][data-active="false"]');
    expect(hidden?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps each document's undo history across a tab switch", async () => {
    // The headline of this phase. Before it, switching remounted the
    // editor and silently dropped its history: ⌘Z after coming back
    // reached nothing.
    const { container } = mount();
    await click("open-tab"); // two tabs, second active
    await click("activate-first");

    typeIntoEditor(activePane(container), "first draft");
    await waitFor(() => expect(activePane(container).textContent).toContain("first draft"));

    // Work in the other tab, then come back.
    await click("activate-second");
    typeIntoEditor(activePane(container), "other document");
    await waitFor(() => expect(activePane(container).textContent).toContain("other document"));
    await click("activate-first");
    await waitFor(() => expect(activePane(container).textContent).toContain("first draft"));

    pressUndo(activePane(container));

    // Undo reached the edit made before the detour — the history was
    // still there.
    await waitFor(() => expect(activePane(container).textContent).not.toContain("first draft"));
  });

  it("undo in one tab leaves the other alone", async () => {
    const { container } = mount();
    await click("open-tab");
    await click("activate-first");
    typeIntoEditor(activePane(container), "document one");
    await waitFor(() => expect(activePane(container).textContent).toContain("document one"));

    await click("activate-second");
    typeIntoEditor(activePane(container), "document two");
    await waitFor(() => expect(activePane(container).textContent).toContain("document two"));

    pressUndo(activePane(container));
    await waitFor(() => expect(activePane(container).textContent).not.toContain("document two"));

    // The first document is untouched by the second's undo.
    await click("activate-first");
    expect(activePane(container).textContent).toContain("document one");
  });
});

describe("window shortcuts stay single with several editors mounted", () => {
  it("⌘F opens find-and-replace once, in the active pane only", async () => {
    const { container } = mount();
    await click("open-tab");

    await act(async () => {
      fireEvent.keyDown(window, { key: "f", metaKey: true });
    });

    // One find bar, and it belongs to the visible pane. Without the
    // isActive gate both mounted panes would open one.
    await waitFor(() => {
      const bars = container.querySelectorAll('[data-testid="fm-findbar"]');
      expect(bars).toHaveLength(1);
    });
    expect(activePane(container).querySelector('[data-testid="fm-findbar"]')).toBeTruthy();
  });
});
