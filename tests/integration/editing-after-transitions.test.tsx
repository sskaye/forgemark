import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { typeIntoEditor, editorText } from "../utils/typing";

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

// The rendered editor gates onUpdate behind `editorReadyRef`, which is
// closed and reopened around every content swap, and the editor itself is
// remounted whenever `loadGeneration` changes. Both mechanisms are
// invisible from the outside and both can silently swallow keystrokes if
// they get out of step — that is exactly how the empty-Untitled bug
// happened, and it survived the whole suite because nothing typed.
//
// So: after each transition that touches the gate or forces a remount,
// assert a real keystroke still reaches document state.

function Probe() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="gen">{state.loadGeneration}</span>
      <span data-testid="name">{state.fileName}</span>
      <button
        data-testid="load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/doc.md",
            fileName: "doc.md",
            text: "loaded body\n",
            body: "loaded body\n",
            comments: [],
            readOnly: false,
          })
        }
      />
      <button
        data-testid="save-as"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/renamed.md",
            fileName: "renamed.md",
            text: "loaded body\n",
            body: "loaded body\n",
            comments: [],
            readOnly: false,
            rebindOnly: true,
          })
        }
      />
      <button data-testid="new" onClick={() => dispatch({ type: "newUntitled" })} />
      <button
        data-testid="detect-external"
        onClick={() =>
          dispatch({
            type: "externalChangeDetected",
            text: "from disk\n",
            body: "from disk\n",
            comments: [],
            fingerprint: { mtimeMs: 9, hash: "h" },
          })
        }
      />
      <button data-testid="reload" onClick={() => dispatch({ type: "applyExternalChange" })} />
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

const dirty = () => screen.getByTestId("dirty").textContent;
const click = async (id: string) => {
  await act(async () => {
    screen.getByTestId(id).click();
  });
};

async function expectTypingReachesState(container: HTMLElement, text: string) {
  expect(dirty()).toBe("clean");
  typeIntoEditor(container, text);
  await waitFor(() => expect(dirty()).toBe("dirty"));
  expect(editorText(container)).toContain(text);
}

describe("typing still reaches state after each transition", () => {
  beforeEach(async () => {
    await waitFor(() => expect(true).toBe(true));
  });

  it("on a fresh Untitled buffer", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    await expectTypingReachesState(container, "fresh");
  });

  it("after opening a file", async () => {
    const { container } = mount();
    await click("load");
    await waitFor(() => expect(editorText(container)).toContain("loaded body"));
    await expectTypingReachesState(container, "after open");
  });

  it("after New (⌘N) from a loaded document", async () => {
    // newUntitled bumps loadGeneration and empties the body — the exact
    // combination that reproduced the original bug.
    const { container } = mount();
    await click("load");
    await waitFor(() => expect(editorText(container)).toContain("loaded body"));
    await click("new");
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Untitled"));
    await expectTypingReachesState(container, "after new");
  });

  it("after reloading from disk", async () => {
    // applyExternalChange replaces the buffer and bumps loadGeneration,
    // remounting the editor.
    const { container } = mount();
    await click("load");
    await waitFor(() => expect(editorText(container)).toContain("loaded body"));
    await click("detect-external");
    await click("reload");
    await waitFor(() => expect(editorText(container)).toContain("from disk"));
    await expectTypingReachesState(container, "after reload");
  });

  it("after Save As rebinds the path", async () => {
    // The one transition that deliberately does NOT remount (undo has to
    // survive), so the gate is never reclosed. Worth pinning precisely
    // because it's the exception.
    const { container } = mount();
    await click("load");
    await waitFor(() => expect(editorText(container)).toContain("loaded body"));
    const genBefore = screen.getByTestId("gen").textContent;

    await click("save-as");
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("renamed.md"));
    expect(screen.getByTestId("gen").textContent).toBe(genBefore);

    await expectTypingReachesState(container, "after save as");
  });
});
