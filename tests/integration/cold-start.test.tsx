import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { readDocument } from "../../src/services/fileIO";

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

// Tabs are a within-session working set. A launch starts clean: the file
// the OS handed over, or a blank Untitled buffer. Nothing from the last
// run comes back on its own — otherwise every launch inherits the
// previous one's clutter and has to be tidied by hand.

function Probe() {
  const { workspace } = useWorkspace();
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{workspace.docs[workspace.activeId].fileName}</span>
      <span data-testid="names">
        {workspace.order.map((id) => workspace.docs[id].fileName).join(",")}
      </span>
    </div>
  );
}

function launch() {
  return render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const handOverFile = async (path: string, name: string, body: string) => {
  vi.mocked(readDocument).mockResolvedValue({
    path,
    fileName: name,
    text: body,
    readOnly: false,
  } as never);
  await act(async () => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path } }));
  });
};

describe("cold start", () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
  });

  it("opens on a single blank document when launched on its own", async () => {
    launch();

    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("1"));
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");
  });

  it("opens only the handed-over file when launched with one", async () => {
    launch();
    await handOverFile("/docs/one.md", "one.md", "one\n");

    // The untouched Untitled buffer is reused rather than left alongside.
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("one.md"));
  });

  it("does not bring back the previous run's tabs", async () => {
    const first = launch();
    await handOverFile("/docs/one.md", "one.md", "one\n");
    await handOverFile("/docs/two.md", "two.md", "two\n");
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("one.md,two.md"));

    first.unmount();
    launch();

    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("1"));
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");
    // The files were never re-read, so nothing tried to restore them.
    expect(vi.mocked(readDocument)).toHaveBeenCalledTimes(2);
  });
});
