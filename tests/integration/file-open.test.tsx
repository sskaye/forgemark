import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { DocumentBindings } from "../../src/state/DocumentBindings";

// Phase 2 file-IO edge-case tests. Mocks the Tauri plugins because jsdom
// has no Tauri runtime.

const mockOpen = vi.fn();
const mockSave = vi.fn();
const mockReadTextFile = vi.fn();
const mockWriteTextFile = vi.fn();
const mockStat = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  save: (...args: unknown[]) => mockSave(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

// Minimal harness — DocumentProvider + DocumentBindings + a tiny consumer
// that surfaces file/dirty/read-only state into the DOM for assertions.
function StateProbe() {
  const { state } = useDocument();
  return (
    <div>
      <span data-testid="probe-name">{state.fileName}</span>
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="probe-readonly">{state.readOnly ? "ro" : "rw"}</span>
      <span data-testid="probe-body">{state.body}</span>
    </div>
  );
}

function renderHarness(logger: (m: string, e: unknown) => void = () => {}) {
  return render(
    <DocumentProvider>
      <DocumentBindings logger={logger} />
      <StateProbe />
    </DocumentProvider>,
  );
}

beforeEach(() => {
  mockOpen.mockReset();
  mockSave.mockReset();
  mockReadTextFile.mockReset();
  mockWriteTextFile.mockReset();
  mockStat.mockReset();
});

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true }));
  });
}

describe("file open edge cases", () => {
  it("loads a markdown file when the dialog returns a path", async () => {
    mockOpen.mockResolvedValue("/tmp/example.md");
    mockStat.mockResolvedValue({ isDirectory: false, readonly: false });
    mockReadTextFile.mockResolvedValue("# Hello\n");

    renderHarness();
    pressKey("o");

    await waitFor(() => {
      expect(screen.getByTestId("probe-name").textContent).toBe("example.md");
      expect(screen.getByTestId("probe-body").textContent).toBe("# Hello\n");
      expect(screen.getByTestId("probe-readonly").textContent).toBe("rw");
    });
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockOpen.mockResolvedValue(null);
    const logger = vi.fn();
    renderHarness(logger);
    pressKey("o");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-name").textContent).toBe("Untitled");
  });

  it("logs an error when the chosen file no longer exists", async () => {
    mockOpen.mockResolvedValue("/tmp/missing.md");
    mockStat.mockRejectedValue(new Error("ENOENT"));
    const logger = vi.fn();
    renderHarness(logger);
    pressKey("o");
    await waitFor(() => {
      expect(logger).toHaveBeenCalledWith("open failed", expect.any(Error));
    });
    expect(screen.getByTestId("probe-name").textContent).toBe("Untitled");
  });

  it("logs an error when the chosen path is a directory", async () => {
    mockOpen.mockResolvedValue("/tmp/somedir");
    mockStat.mockResolvedValue({ isDirectory: true, readonly: false });
    const logger = vi.fn();
    renderHarness(logger);
    pressKey("o");
    await waitFor(() => {
      expect(logger).toHaveBeenCalledWith("open failed", expect.any(Error));
    });
  });

  it("logs an error when the chosen path has a non-markdown extension", async () => {
    mockOpen.mockResolvedValue("/tmp/notes.txt");
    mockStat.mockResolvedValue({ isDirectory: false, readonly: false });
    const logger = vi.fn();
    renderHarness(logger);
    pressKey("o");
    await waitFor(() => {
      expect(logger).toHaveBeenCalledWith("open failed", expect.any(Error));
    });
  });

  it("marks read-only files as read-only", async () => {
    mockOpen.mockResolvedValue("/tmp/locked.md");
    mockStat.mockResolvedValue({ isDirectory: false, readonly: true });
    mockReadTextFile.mockResolvedValue("read me");

    renderHarness();
    pressKey("o");

    await waitFor(() => {
      expect(screen.getByTestId("probe-readonly").textContent).toBe("ro");
    });
  });

  it("⌘S writes the original bytes for a no-edits session", async () => {
    mockOpen.mockResolvedValue("/tmp/example.md");
    mockStat.mockResolvedValue({ isDirectory: false, readonly: false });
    mockReadTextFile.mockResolvedValue("alpha\n");
    mockWriteTextFile.mockResolvedValue(undefined);

    renderHarness();
    pressKey("o");
    await waitFor(() => {
      expect(screen.getByTestId("probe-name").textContent).toBe("example.md");
    });
    pressKey("s");
    await waitFor(() => {
      expect(mockWriteTextFile).toHaveBeenCalledWith("/tmp/example.md", "alpha\n");
    });
  });

  it("⌘S on a read-only file is a no-op", async () => {
    mockOpen.mockResolvedValue("/tmp/locked.md");
    mockStat.mockResolvedValue({ isDirectory: false, readonly: true });
    mockReadTextFile.mockResolvedValue("read me");

    renderHarness();
    pressKey("o");
    await waitFor(() => {
      expect(screen.getByTestId("probe-readonly").textContent).toBe("ro");
    });
    pressKey("s");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });
});
