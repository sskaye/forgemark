import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { readSession, writeSession, SESSION_KEY } from "../../src/state/session";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

// Session restore remembers which FILES were open, not their contents.
// Unsaved Untitled buffers are deliberately excluded — persisting those
// would put document content in localStorage, and the unsaved-work guard
// already forces them to be saved or discarded before quitting.

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{workspace.docs[workspace.activeId].fileName}</span>
      <span data-testid="names">
        {workspace.order.map((id) => workspace.docs[id].fileName).join(",")}
      </span>
      <button data-testid="open-tab" onClick={() => dispatch({ type: "openTab" })} />
      <button
        data-testid="load-a"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/docs/a.md",
            fileName: "a.md",
            text: "alpha\n",
            body: "alpha\n",
            comments: [],
            readOnly: false,
          })
        }
      />
      <button data-testid="edit" onClick={() => dispatch({ type: "edit", body: "scratch\n" })} />
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

function fileSystem(files: Record<string, string>) {
  vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, mtime: null } as never);
  vi.mocked(readTextFile).mockImplementation(((path: string) => {
    const text = files[path];
    return text == null ? Promise.reject(new Error("ENOENT")) : Promise.resolve(text);
  }) as never);
}

describe("recording the session", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SESSION_KEY);
  });

  it("records open files and which one was active", async () => {
    mount();
    await click("load-a");

    await waitFor(() => expect(readSession()?.paths).toEqual(["/docs/a.md"]));
    expect(readSession()?.activeIndex).toBe(0);
  });

  it("does not record Untitled buffers", async () => {
    mount();
    await click("edit"); // dirty, but never saved anywhere

    // Nothing worth restoring, so nothing stored.
    await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Untitled"));
    expect(readSession()).toBeNull();
  });

  it("marks the active document as -1 when it's an Untitled tab", async () => {
    mount();
    await click("load-a");
    await click("open-tab"); // Untitled tab is now active

    await waitFor(() => expect(readSession()?.paths).toEqual(["/docs/a.md"]));
    expect(readSession()?.activeIndex).toBe(-1);
  });
});

describe("restoring the session", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SESSION_KEY);
  });

  it("reopens the files in order and focuses the one that was active", async () => {
    fileSystem({ "/docs/one.md": "one\n", "/docs/two.md": "two\n", "/docs/three.md": "three\n" });
    writeSession({
      paths: ["/docs/one.md", "/docs/two.md", "/docs/three.md"],
      activeIndex: 1,
    });

    mount();

    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("3"));
    expect(screen.getByTestId("names").textContent).toBe("one.md,two.md,three.md");
    expect(screen.getByTestId("active-name").textContent).toBe("two.md");
  });

  it("re-reads from disk rather than restoring stale contents", async () => {
    // Paths are stored, not bodies, so a file edited outside Forgemark
    // comes back current.
    fileSystem({ "/docs/one.md": "edited elsewhere since last launch\n" });
    writeSession({ paths: ["/docs/one.md"], activeIndex: 0 });

    const { container } = mount();

    await waitFor(() =>
      expect(container.textContent).toContain("edited elsewhere since last launch"),
    );
  });

  it("skips files that have gone missing and still restores the rest", async () => {
    fileSystem({ "/docs/here.md": "still here\n" });
    writeSession({ paths: ["/docs/gone.md", "/docs/here.md"], activeIndex: 1 });

    mount();

    await waitFor(() => expect(screen.getByTestId("names").textContent).toContain("here.md"));
    expect(screen.getByTestId("names").textContent).not.toContain("gone.md");
    // Focus still lands on the document that was active, matched by path
    // rather than by a position the missing file would have shifted.
    expect(screen.getByTestId("active-name").textContent).toBe("here.md");
  });

  it("starts on a blank document when there's no session", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("1"));
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");
  });

  it("ignores corrupt session data", async () => {
    window.localStorage.setItem(SESSION_KEY, "{not json");
    mount();
    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("1"));
    expect(screen.getByTestId("active-name").textContent).toBe("Untitled");
  });

  it("restores once, not again when another tab opens", async () => {
    // DocumentBindings mounts per document, so a per-instance guard here
    // would re-run the restore every time a tab appeared.
    fileSystem({ "/docs/one.md": "one\n" });
    writeSession({ paths: ["/docs/one.md"], activeIndex: 0 });

    mount();
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("one.md"));

    await click("open-tab");
    await click("open-tab");

    // Three tabs: the restored file plus the two just opened. No repeats.
    expect(screen.getByTestId("tab-count").textContent).toBe("3");
    expect(screen.getByTestId("names").textContent).toBe("one.md,Untitled,Untitled 2");
  });
});
