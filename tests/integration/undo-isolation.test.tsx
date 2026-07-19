import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

// The rendered editor owns the undo stack — ProseMirror's history plugin
// lives inside the Tiptap instance, not in DocumentState. So the only way
// to discard it is to remount, which `key={state.loadGeneration}` in
// EditorPane forces. These tests drive real ⌘Z keystrokes against the
// contenteditable rather than asserting on the counter, because the
// counter is only a proxy for the behavior that actually matters.

function Probe() {
  const { dispatch } = useDocument();
  const load = (fileName: string, body: string, rebindOnly?: boolean) => ({
    type: "load" as const,
    filePath: `/tmp/${fileName}`,
    fileName,
    text: body,
    body,
    comments: [],
    readOnly: false,
    ...(rebindOnly ? { rebindOnly: true } : {}),
  });
  return (
    <div>
      <button data-testid="load-a" onClick={() => dispatch(load("a.md", "AAA original\n"))} />
      <button data-testid="load-b" onClick={() => dispatch(load("b.md", "BBB replacement\n"))} />
      <button
        data-testid="save-as"
        onClick={() => dispatch(load("renamed.md", "AAA original\n", true))}
      />
      <button
        data-testid="edit"
        onClick={() => dispatch({ type: "edit", body: "AAA original edited\n" })}
      />
    </div>
  );
}

function mount() {
  const utils = render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
  return utils;
}

function proseMirror(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".ProseMirror");
  if (!el) throw new Error("rendered editor not mounted");
  return el as HTMLElement;
}

// ProseMirror binds undo as "Mod-z", which resolves to Ctrl-z off macOS.
// jsdom reports a non-Mac platform, so Ctrl is the binding here.
//
// Fire exactly ONE undo. An earlier version of this helper fired both
// Ctrl-z and Meta-z "to be platform-agnostic", which quietly issued two
// undos and made the assertions depend on how deep the history stack
// happened to be rather than on the behavior under test.
function pressUndo(container: HTMLElement) {
  fireEvent.keyDown(proseMirror(container), { key: "z", ctrlKey: true });
}

describe("undo isolation across documents", () => {
  it("undo cannot reach the previous document after opening a new file", async () => {
    const { container } = mount();

    fireEvent.click(screen.getByTestId("load-a"));
    await waitFor(() => expect(proseMirror(container).textContent).toContain("AAA original"));

    fireEvent.click(screen.getByTestId("load-b"));
    await waitFor(() => expect(proseMirror(container).textContent).toContain("BBB replacement"));

    pressUndo(container);

    // The whole point: ⌘Z must not walk backwards into document A.
    await waitFor(() => expect(proseMirror(container).textContent).toContain("BBB replacement"));
    expect(proseMirror(container).textContent).not.toContain("AAA original");
  });

  it("undo still works within a single document", async () => {
    // Guard against the trivial way to pass the test above: breaking
    // undo entirely. A programmatic body replacement (the same path
    // accept-suggestion uses) must remain undoable.
    const { container } = mount();

    fireEvent.click(screen.getByTestId("load-a"));
    await waitFor(() => expect(proseMirror(container).textContent).toContain("AAA original"));

    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() => expect(proseMirror(container).textContent).toContain("edited"));

    pressUndo(container);

    await waitFor(() => expect(proseMirror(container).textContent).not.toContain("edited"));
    expect(proseMirror(container).textContent).toContain("AAA original");
  });

  it("Save As rebinds the path without remounting the editor", async () => {
    // Save As re-dispatches `load` purely to pick up the new path. The
    // buffer is unchanged, so the editor instance — and with it the
    // user's undo history — has to survive. Node identity is the
    // observable proof that no remount happened.
    const { container } = mount();

    fireEvent.click(screen.getByTestId("load-a"));
    await waitFor(() => expect(proseMirror(container).textContent).toContain("AAA original"));
    const before = proseMirror(container);

    fireEvent.click(screen.getByTestId("save-as"));
    await waitFor(() => expect(screen.getByText(/renamed\.md/)).toBeTruthy());

    expect(proseMirror(container)).toBe(before);
  });
});
