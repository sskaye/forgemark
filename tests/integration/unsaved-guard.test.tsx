import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { saveMarkdownFile, openMarkdownFile } from "../../src/services/fileIO";

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

// ⌘N and ⌘O discard the open buffer. Auto-save normally means there's
// nothing to lose — but it's skipped for Untitled documents and while a
// conflict is pending, and those were exactly the cases that discarded
// silently. See `guardDiscard` in DocumentBindings.

function Probe() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="body">{state.body}</span>
      <span data-testid="dirty">{state.dirty ? "dirty" : "clean"}</span>
      <button
        data-testid="load-saved"
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

function pressNewDocument() {
  fireEvent.keyDown(window, { key: "n", metaKey: true });
}

const body = () => screen.getByTestId("body").textContent;

describe("unsaved-work guard", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/saved.md");
    vi.mocked(openMarkdownFile)
      .mockReset()
      .mockResolvedValue(null as never);
  });

  it("prompts instead of discarding an Untitled buffer", async () => {
    mount();
    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));

    await act(async () => pressNewDocument());

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    // Crucially, the work is still there — the prompt blocks the discard
    // rather than reporting it after the fact.
    expect(body()).toBe("precious work\n");
  });

  it("Don't Save discards, Cancel does not", async () => {
    const { unmount } = mount();
    fireEvent.click(screen.getByTestId("edit"));
    await act(async () => pressNewDocument());
    await screen.findByTestId("fm-unsaved-modal");

    fireEvent.click(screen.getByTestId("fm-unsaved-cancel"));
    await waitFor(() => expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull());
    expect(body()).toBe("precious work\n");
    unmount();

    mount();
    fireEvent.click(screen.getByTestId("edit"));
    await act(async () => pressNewDocument());
    await screen.findByTestId("fm-unsaved-modal");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });
    await waitFor(() => expect(body()).toBe(""));
  });

  it("saves silently and proceeds when the file already has a path", async () => {
    // Forgemark is auto-save-first: prompting to save something auto-save
    // would have written 500ms later would be incoherent.
    mount();
    fireEvent.click(screen.getByTestId("load-saved"));
    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));

    await act(async () => pressNewDocument());

    await waitFor(() => expect(body()).toBe(""));
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
    expect(vi.mocked(saveMarkdownFile)).toHaveBeenCalledWith("/tmp/saved.md", "precious work\n");
  });

  it("offers no Save button while a conflict is pending", async () => {
    // Saving mid-conflict would clobber the disk copy, so the only safe
    // choices here are discard or cancel.
    mount();
    fireEvent.click(screen.getByTestId("load-saved"));
    fireEvent.click(screen.getByTestId("edit"));
    fireEvent.click(screen.getByTestId("conflict"));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("dirty"));

    await act(async () => pressNewDocument());

    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(screen.queryByTestId("fm-unsaved-save")).toBeNull();
    expect(screen.getByTestId("fm-unsaved-discard")).toBeTruthy();
    expect(vi.mocked(saveMarkdownFile)).not.toHaveBeenCalled();
  });

  it("does not prompt when there is nothing to lose", async () => {
    mount();
    fireEvent.click(screen.getByTestId("load-saved"));
    await waitFor(() => expect(body()).toBe("on disk\n"));

    await act(async () => pressNewDocument());

    await waitFor(() => expect(body()).toBe(""));
    expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull();
  });
});
