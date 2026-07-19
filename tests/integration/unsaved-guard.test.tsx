import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { saveMarkdownFile, openMarkdownFile } from "../../src/services/fileIO";
import { invoke } from "@tauri-apps/api/core";

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

// Since tabs landed, ⌘N and ⌘O open a new tab and discard nothing, so
// they no longer need a guard. The two actions that DO destroy work are
// closing a tab and quitting — that's what this covers.
//
// Auto-save means a saved document is only dirty for the ~500ms since the
// last keystroke, so the exposed cases are the ones auto-save skips:
// Untitled buffers (no path to write to) and documents with a pending
// conflict (writing would clobber the disk copy).

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  const active = workspace.docs[workspace.activeId];
  return (
    <div>
      <span data-testid="body">{active.body}</span>
      <span data-testid="name">{active.fileName}</span>
      <span data-testid="dirty">{active.dirty ? "dirty" : "clean"}</span>
      <span data-testid="tab-count">{workspace.order.length}</span>
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
        data-testid="edit"
        onClick={() => dispatch({ type: "edit", body: "precious work\n" })}
      />
      <button
        data-testid="conflict"
        onClick={() =>
          dispatch({
            type: "externalChangeDetected",
            text: "changed underneath\n",
            body: "changed underneath\n",
            comments: [],
            fingerprint: { mtimeMs: 2, hash: "zzz" },
          })
        }
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

const body = () => screen.getByTestId("body").textContent;
const click = async (id: string) => {
  await act(async () => {
    screen.getByTestId(id).click();
  });
};

// File > Close, which the tab strip's × also routes through.
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

describe("opening no longer discards anything", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/saved.md");
    vi.mocked(openMarkdownFile)
      .mockReset()
      .mockResolvedValue(null as never);
    vi.mocked(invoke).mockClear();
  });

  it("⌘N opens a tab instead of replacing unsaved work", async () => {
    // This used to prompt, because ⌘N destroyed the buffer in place.
    mount();
    await click("edit");
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));

    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true });
    });

    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("2"));
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
    // The work is still open in its own tab, untouched.
    expect(body()).toBe("");
    expect(screen.getByTestId("name").textContent).toBe("Untitled 2");
  });
});

describe("closing a tab guards unsaved work", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/saved.md");
    vi.mocked(invoke).mockClear();
  });

  it("prompts instead of dropping an Untitled buffer", async () => {
    mount();
    await click("edit");
    await closeTab();

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    // The prompt blocks the close rather than reporting it afterwards.
    expect(body()).toBe("precious work\n");
  });

  it("Cancel keeps the document; Don't Save drops it", async () => {
    const { unmount } = mount();
    await click("edit");
    await closeTab();
    await screen.findByTestId("fm-unsaved-modal");

    fireEvent.click(screen.getByTestId("fm-unsaved-cancel"));
    await waitFor(() => expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull());
    expect(body()).toBe("precious work\n");
    unmount();

    mount();
    await click("edit");
    await closeTab();
    await screen.findByTestId("fm-unsaved-modal");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });
    // Closing the last tab leaves a fresh Untitled one rather than an
    // empty window.
    await waitFor(() => expect(body()).toBe(""));
    expect(screen.getByTestId("tab-count").textContent).toBe("1");
  });

  it("saves silently when the document already has a path", async () => {
    // Forgemark is auto-save-first: prompting to save something auto-save
    // would have written 500ms later would be incoherent.
    mount();
    await click("load");
    await click("edit");
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));

    await closeTab();

    await waitFor(() =>
      expect(vi.mocked(saveMarkdownFile)).toHaveBeenCalledWith("/tmp/saved.md", "precious work\n"),
    );
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
  });

  it("offers no Save button while a conflict is pending", async () => {
    // Saving mid-conflict would clobber the disk copy, so the only safe
    // choices are discard or cancel.
    mount();
    await click("load");
    await click("edit");
    await click("conflict");

    await closeTab();

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(screen.queryByTestId("fm-unsaved-save")).toBeNull();
    expect(screen.getByTestId("fm-unsaved-discard")).toBeTruthy();
    expect(vi.mocked(saveMarkdownFile)).not.toHaveBeenCalled();
  });

  it("does not prompt when there is nothing to lose", async () => {
    mount();
    await click("load");
    await waitFor(() => expect(body()).toBe("on disk\n"));

    await closeTab();

    await waitFor(() => expect(body()).toBe(""));
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
  });
});

describe("quitting guards unsaved work", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/saved.md");
    vi.mocked(invoke).mockClear();
  });

  it("waits for the prompt, then tells Rust it may exit", async () => {
    mount();
    await click("edit");
    await requestQuit();

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("approve_exit");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("approve_exit"));
  });

  it("exits straight away when nothing is dirty", async () => {
    mount();
    await click("load");
    await waitFor(() => expect(body()).toBe("on disk\n"));

    await requestQuit();

    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("approve_exit"));
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
  });
});
