import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { watch } from "@tauri-apps/plugin-fs";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { saveMarkdownFile } from "../../src/services/fileIO";

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

// Phase 2: DocumentBindings is mounted once per OPEN document, not once
// per visible one. Bindings own auto-save and the external-change
// watcher, so a background document whose bindings weren't mounted would
// quietly stop saving and stop noticing its file changed on disk.
//
// The flip side is that the window-level listeners inside them
// (shortcuts, menu commands, quit) are app-wide singletons and must fire
// exactly once no matter how many documents are open.

function Workbench() {
  const { workspace, dispatch } = useWorkspace();
  const load = (docId: string, path: string, name: string, body: string) =>
    dispatch({
      type: "load",
      docId,
      filePath: path,
      fileName: name,
      text: body,
      body,
      comments: [],
      readOnly: false,
    });
  const first = workspace.order[0];
  const second = workspace.order[1];
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{workspace.docs[workspace.activeId].fileName}</span>
      <span data-testid="first-body">{workspace.docs[first]?.body}</span>
      <span data-testid="first-dirty">{workspace.docs[first]?.dirty ? "dirty" : "clean"}</span>
      <button data-testid="open-tab" onClick={() => dispatch({ type: "openTab" })} />
      <button
        data-testid="load-first"
        onClick={() => load(first, "/docs/first.md", "first.md", "first body\n")}
      />
      <button
        data-testid="load-second"
        onClick={() => load(second, "/other/second.md", "second.md", "second body\n")}
      />
      <button
        data-testid="edit-first"
        onClick={() => dispatch({ type: "edit", docId: first, body: "edited in background\n" })}
      />
    </div>
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Workbench />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const click = async (id: string) => {
  await act(async () => {
    screen.getByTestId(id).click();
  });
};

describe("background documents keep their own side effects", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/docs/first.md");
    vi.mocked(watch).mockClear();
  });

  it("auto-saves a document that isn't the active tab", async () => {
    // The regression this guards: tie bindings to the visible document
    // and edits to a background tab are never written to disk.
    mount();
    await click("load-first");
    await click("open-tab"); // first.md is now in the background
    expect(screen.getByTestId("tab-count").textContent).toBe("2");
    // "Untitled" rather than "Untitled 2": the first tab now has a path,
    // so it no longer occupies an untitled number.
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");

    await click("edit-first");
    expect(screen.getByTestId("first-dirty").textContent).toBe("dirty");

    await waitFor(
      () =>
        expect(vi.mocked(saveMarkdownFile)).toHaveBeenCalledWith(
          "/docs/first.md",
          "edited in background\n",
        ),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.getByTestId("first-dirty").textContent).toBe("clean"));
  });

  it("watches every open file, not just the visible one", async () => {
    mount();
    await click("load-first");
    await click("open-tab");
    await click("load-second");

    // Two documents in two different directories → two watchers.
    await waitFor(() => {
      const dirs = vi.mocked(watch).mock.calls.map((c) => String(c[0]));
      expect(dirs.some((d) => d.includes("/docs"))).toBe(true);
      expect(dirs.some((d) => d.includes("/other"))).toBe(true);
    });
  });
});

describe("window-level listeners stay single", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/other/second.md");
    vi.mocked(watch).mockClear();
  });

  it("⌘S saves only the active document, once", async () => {
    // Both documents are clean, so auto-save can't fire and every write
    // observed here came from the shortcut. Two mounted bindings without
    // the isActive gate would produce two saves.
    mount();
    await click("load-first");
    await click("open-tab");
    await click("load-second");
    expect(screen.getByTestId("active-name").textContent).toBe("second.md");

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });

    await waitFor(() => expect(vi.mocked(saveMarkdownFile)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveMarkdownFile)).toHaveBeenCalledWith("/other/second.md", "second body\n");
  });

  it("⌘N replaces only the active document", async () => {
    mount();
    await click("load-first");
    await click("open-tab");
    await click("load-second");

    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true });
    });

    // The active tab resets; the background one is untouched.
    await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Untitled"));
    expect(screen.getByTestId("first-body").textContent).toBe("first body\n");
    expect(screen.getByTestId("tab-count").textContent).toBe("2");
  });
});
