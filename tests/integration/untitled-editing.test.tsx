import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { RenderedView } from "../../src/components/RenderedView";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

// Regression: typing into an *empty* Untitled buffer produced no edit at
// all. `editorReadyRef` gates onUpdate and used to be flipped only by the
// content-sync effect — which early-returns when the content already
// matches, and an empty buffer always matches. The gate stayed shut, so
// every keystroke was swallowed: the document never went dirty, never
// auto-saved (auto-save requires `dirty`), and ⌘S would have written the
// empty originalText over the top of what was on screen.
//
// Typing is simulated the way ProseMirror actually observes it — mutate
// the contenteditable and let its DOMObserver pick the change up.
function typeInto(container: HTMLElement, text: string) {
  const pm = container.querySelector(".ProseMirror") as HTMLElement | null;
  if (!pm) throw new Error("rendered editor not mounted");
  const target = pm.querySelector("p") ?? pm;
  target.textContent = text;
  fireEvent.input(pm);
}

describe("editing an empty Untitled document", () => {
  it("reaches onEdit (the gate is open at mount)", async () => {
    const onEdit = vi.fn();
    const { container } = render(
      <RenderedView
        body=""
        onEdit={onEdit}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());

    typeInto(container, "test");

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(onEdit.mock.calls.at(-1)?.[0]).toContain("test");
  });

  it("still reaches onEdit for a loaded document", async () => {
    // Control: this path always worked, because a non-empty body differs
    // from the ref's seed and so ran the sync effect that opened the gate.
    const onEdit = vi.fn();
    const { container } = render(
      <RenderedView
        body={"hello\n"}
        onEdit={onEdit}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain("hello"));

    typeInto(container, "hello world");

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(onEdit.mock.calls.at(-1)?.[0]).toContain("hello world");
  });

  it("marks the document dirty, so it can auto-save and prompt on quit", async () => {
    // The user-visible symptom: no dot in the title bar next to Untitled.
    function Probe() {
      const { state } = useDocument();
      return <span data-testid="dirty">{state.dirty ? "dirty" : "clean"}</span>;
    }
    const { container } = render(
      <ThemeProvider>
        <DocumentProvider>
          <AppShell />
          <Probe />
        </DocumentProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    expect(screen.getByTestId("dirty").textContent).toBe("clean");

    typeInto(container, "test");

    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));
    expect(document.title).toContain("•");
  });
});
