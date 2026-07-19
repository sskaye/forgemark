import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { saveMarkdownFile, readMarkdownFile } from "../../src/services/fileIO";
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

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  const active = workspace.docs[workspace.activeId];
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{active.fileName}</span>
      <span data-testid="active-body">{active.body}</span>
      <button data-testid="open-tab" onClick={() => dispatch({ type: "openTab" })} />
      <button data-testid="edit" onClick={() => dispatch({ type: "edit", body: "unsaved\n" })} />
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

const openFile = async (path: string, name: string, body: string) => {
  vi.mocked(readMarkdownFile).mockResolvedValue({
    path,
    fileName: name,
    text: body,
    readOnly: false,
  } as never);
  await act(async () => {
    window.dispatchEvent(new CustomEvent("forgemark:open-path", { detail: { path } }));
  });
};

describe("tab bar", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/x.md");
    vi.mocked(invoke).mockClear();
  });

  it("stays hidden while a single document is open", async () => {
    // The app was quiet before tabs; one document should look unchanged.
    mount();
    await waitFor(() => expect(screen.getByTestId("fm-app-shell")).toBeTruthy());
    expect(screen.queryByTestId("fm-tabbar")).toBeNull();
  });

  it("appears once a second document opens, and switches on click", async () => {
    mount();
    await click("open-tab");

    const bar = await screen.findByTestId("fm-tabbar");
    const tabs = bar.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled 2");

    await act(async () => {
      fireEvent.click(tabs[0]);
    });
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("closing from the strip goes through the unsaved-work guard", async () => {
    mount();
    await click("open-tab");
    await click("edit"); // active (second) tab now has unsaved work

    const bar = await screen.findByTestId("fm-tabbar");
    const closeButtons = bar.querySelectorAll('[data-testid^="fm-tab-close-"]');
    await act(async () => {
      fireEvent.click(closeButtons[1]);
    });

    // Untitled + dirty is exactly the case auto-save can't handle, so it
    // must ask rather than dropping the tab.
    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(screen.getByTestId("tab-count").textContent).toBe("2");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });
    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("1"));
  });
});

describe("opening files into tabs", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset();
    vi.mocked(invoke).mockClear();
  });

  it("reuses an untouched Untitled tab rather than leaving it behind", async () => {
    mount();
    await openFile("/tmp/a.md", "a.md", "alpha\n");

    expect(screen.getByTestId("tab-count").textContent).toBe("1");
    expect(screen.getByTestId("active-name").textContent).toBe("a.md");
    expect(screen.queryByTestId("fm-tabbar")).toBeNull();
  });

  it("opens a second file in its own tab", async () => {
    mount();
    await openFile("/tmp/a.md", "a.md", "alpha\n");
    await openFile("/tmp/b.md", "b.md", "bravo\n");

    expect(screen.getByTestId("tab-count").textContent).toBe("2");
    expect(screen.getByTestId("active-name").textContent).toBe("b.md");
  });

  it("focuses the existing tab when the file is already open", async () => {
    // Two tabs on one path would run two watchers and two auto-save loops
    // against the same file.
    mount();
    await openFile("/tmp/a.md", "a.md", "alpha\n");
    await openFile("/tmp/b.md", "b.md", "bravo\n");
    expect(screen.getByTestId("tab-count").textContent).toBe("2");

    await openFile("/tmp/a.md", "a.md", "alpha\n");

    expect(screen.getByTestId("tab-count").textContent).toBe("2");
    expect(screen.getByTestId("active-name").textContent).toBe("a.md");
  });
});

describe("quitting with several documents", () => {
  beforeEach(() => {
    vi.mocked(saveMarkdownFile).mockReset().mockResolvedValue("/tmp/x.md");
    vi.mocked(invoke).mockClear();
  });

  it("asks about a background document before exiting", async () => {
    // Each document's file IO lives in its own bindings instance, so the
    // quit walks the tabs: it brings the unsaved one forward, asks, then
    // carries on. Prompting about a document the user can't see would be
    // baffling, and exiting without asking would lose their work.
    mount();
    await click("edit"); // first tab is dirty and Untitled
    await click("open-tab"); // …and now in the background
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled 2");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("forgemark:close-requested"));
    });

    // The dirty document is brought to the front and asked about.
    const modal = await screen.findByTestId("fm-unsaved-modal");
    expect(modal).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Untitled"));
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("approve_exit");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-discard"));
    });

    // Having dealt with the last unsaved document, the quit proceeds.
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("approve_exit"));
  });
});
