import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { saveDocument } from "../../src/services/fileIO";
import { invoke } from "@tauri-apps/api/core";

// Four bugs in the save / close / quit state machine, each reproduced
// before it was fixed:
//
//   1. ⌘Q with a read-only document holding an unsaved comment looped
//      forever between the quit walk and the discard guard.
//   2. A keystroke typed while a save was in flight was thrown away when
//      the save finished.
//   3. A silent save that failed still closed the tab.
//   4. "Save" from the unsaved prompt on an Untitled buffer wrote the
//      file but never carried out the close it was answering.

vi.mock("../../src/services/fileIO", () => ({
  openDocument: vi.fn(),
  openDocuments: vi.fn(),
  readDocument: vi.fn(),
  saveDocument: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(() => Promise.resolve()),
  lstat: vi.fn(() => Promise.resolve({ isSymlink: false })),
  remove: vi.fn(() => Promise.resolve()),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  const active = workspace.docs[workspace.activeId];
  return (
    <div>
      <span data-testid="body">{active.body}</span>
      <span data-testid="name">{active.fileName}</span>
      <span data-testid="path">{active.filePath ?? ""}</span>
      <span data-testid="dirty">{active.dirty ? "dirty" : "clean"}</span>
      <span data-testid="view">{active.viewMode}</span>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="comment-count">{active.comments.length}</span>
      <button
        data-testid="load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/saved.md",
            fileName: "saved.md",
            text: "on disk\n",
            body: "on disk\n",
            comments: [],
            readOnly: false,
          })
        }
      />
      <button
        data-testid="load-readonly"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/locked.md",
            fileName: "locked.md",
            text: "locked\n",
            body: "locked\n",
            comments: [],
            readOnly: true,
          })
        }
      />
      <button
        data-testid="comment"
        onClick={() =>
          dispatch({
            type: "addComment",
            body: active.body,
            comment: {
              id: 1,
              floating: true,
              author: "Maya",
              timestamp: "2026-09-03T12:00:00Z",
              resolved: false,
              body: "note\n",
            },
          })
        }
      />
      <button data-testid="edit" onClick={() => dispatch({ type: "edit", body: "first edit\n" })} />
      <button
        data-testid="edit-more"
        onClick={() => dispatch({ type: "edit", body: "first edit and more\n" })}
      />
      <button
        data-testid="source-view"
        onClick={() => dispatch({ type: "setViewMode", viewMode: "source" })}
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

const text = (id: string) => screen.getByTestId(id).textContent;
const click = async (id: string) => {
  await act(async () => {
    screen.getByTestId(id).click();
  });
};
async function closeTab() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("forgemark:menu", { detail: "close-file" }));
  });
}
async function requestQuit() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("forgemark:close-requested"));
  });
}
const pressSave = () => fireEvent.keyDown(window, { key: "s", metaKey: true });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
  vi.mocked(saveDocument).mockReset().mockResolvedValue("/tmp/saved.md");
  vi.mocked(invoke).mockClear();
});

describe("a read-only document with unsaved comments", () => {
  it("is asked about on quit instead of looping forever", async () => {
    mount();
    await click("load-readonly");
    await click("comment");
    expect(text("dirty")).toBe("dirty");

    await requestQuit();

    // The guard can't save it where it is, so it prompts — and offers
    // Save, which becomes a Save As.
    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(screen.getByTestId("fm-unsaved-save")).toBeTruthy();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("approve_exit");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("approve_exit"));
  });

  it("⌘S offers Save As rather than doing nothing", async () => {
    mount();
    await click("load-readonly");
    await click("comment");
    vi.mocked(saveDocument).mockResolvedValue("/tmp/review-copy.md");

    pressSave();

    await waitFor(() =>
      expect(vi.mocked(saveDocument)).toHaveBeenCalledWith(
        null,
        expect.stringContaining("forgemark-comments"),
        "markdown",
        "locked.md",
      ),
    );
    await waitFor(() => expect(text("path")).toBe("/tmp/review-copy.md"));
    await waitFor(() => expect(text("dirty")).toBe("clean"));
  });
});

describe("a keystroke typed while a save is in flight", () => {
  it("survives, and the document stays dirty", async () => {
    let finishWrite: (path: string) => void = () => {};
    vi.mocked(saveDocument).mockImplementation(
      () => new Promise<string | null>((resolve) => (finishWrite = resolve)),
    );
    mount();
    await click("load");
    await click("edit");
    pressSave();
    await waitFor(() => expect(vi.mocked(saveDocument)).toHaveBeenCalledTimes(1));

    // The write is still pending. Type on.
    await click("edit-more");
    expect(text("body")).toBe("first edit and more\n");

    await act(async () => {
      finishWrite("/tmp/saved.md");
    });

    // The newer text is still there and still unsaved.
    await waitFor(() => expect(text("body")).toBe("first edit and more\n"));
    expect(text("dirty")).toBe("dirty");
  });
});

describe("a silent save that fails", () => {
  it("keeps the tab and asks, instead of closing over the error", async () => {
    vi.mocked(saveDocument).mockRejectedValue(new Error("ENOSPC: no space left"));
    mount();
    await click("load");
    await click("edit");

    await closeTab();

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(text("tab-count")).toBe("1");
    expect(text("body")).toBe("first edit\n");
    expect(screen.getByTestId("fm-error-banner").textContent).toMatch(/ENOSPC/);
  });
});

describe("Save from the unsaved prompt", () => {
  it("saves an Untitled buffer and then carries out the close", async () => {
    mount();
    await click("edit"); // Untitled, dirty
    vi.mocked(saveDocument).mockResolvedValue("/tmp/chosen.md");

    await closeTab();
    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-save"));
    });

    await waitFor(() => expect(vi.mocked(saveDocument)).toHaveBeenCalled());
    // The close went through: the only tab is a fresh Untitled buffer.
    await waitFor(() => expect(text("name")).toMatch(/^Untitled/));
    expect(text("body")).toBe("");
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
  });

  it("keeps the tab when the user cancels the location dialog", async () => {
    mount();
    await click("edit");
    vi.mocked(saveDocument).mockResolvedValue(null);

    await closeTab();
    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-save"));
    });

    await waitFor(() => expect(vi.mocked(saveDocument)).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull());
    expect(text("body")).toBe("first edit\n");
    expect(text("dirty")).toBe("dirty");
  });
});

describe("Save As", () => {
  it("keeps the view mode and undo history rather than reloading", async () => {
    mount();
    await click("load");
    await click("source-view");
    await click("edit");
    vi.mocked(saveDocument).mockResolvedValue("/tmp/renamed.md");

    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });

    await waitFor(() => expect(text("path")).toBe("/tmp/renamed.md"));
    expect(text("name")).toBe("renamed.md");
    expect(text("view")).toBe("source");
    expect(text("dirty")).toBe("clean");
  });

  it("proposes the document's own name", async () => {
    mount();
    await click("load");
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(vi.mocked(saveDocument)).toHaveBeenCalledWith(
        null,
        "on disk\n",
        "markdown",
        "saved.md",
      ),
    );
  });
});
