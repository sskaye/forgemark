import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

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
  return (
    <div>
      <span data-testid="tab-count">{workspace.order.length}</span>
      <span data-testid="active-name">{workspace.docs[workspace.activeId].fileName}</span>
      <span data-testid="names">
        {workspace.order.map((id) => workspace.docs[id].fileName).join(",")}
      </span>
      <button data-testid="open-tab" onClick={() => dispatch({ type: "openTab" })} />
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

const menu = async (detail: string) => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("forgemark:menu", { detail }));
  });
};

const active = () => screen.getByTestId("active-name").textContent;

describe("tab navigation", () => {
  it("cycles forward and back, wrapping at both ends", async () => {
    mount();
    await click("open-tab");
    await click("open-tab");
    expect(screen.getByTestId("names").textContent).toBe("Untitled,Untitled 2,Untitled 3");
    expect(active()).toBe("Untitled 3");

    // Forward from the last wraps to the first.
    await menu("next-tab");
    expect(active()).toBe("Untitled");

    await menu("next-tab");
    expect(active()).toBe("Untitled 2");

    // Back from the first wraps to the last.
    await menu("prev-tab");
    expect(active()).toBe("Untitled");
    await menu("prev-tab");
    expect(active()).toBe("Untitled 3");
  });

  it("is a no-op with a single document", async () => {
    mount();
    expect(active()).toBe("Untitled");

    await menu("next-tab");
    await menu("prev-tab");

    expect(active()).toBe("Untitled");
    expect(screen.getByTestId("tab-count").textContent).toBe("1");
  });
});

describe("opening several files at once", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  it("gives each selected file its own tab", async () => {
    const { readTextFile, stat } = await import("@tauri-apps/plugin-fs");
    vi.mocked(open).mockResolvedValue(["/docs/one.md", "/docs/two.md"] as never);
    vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, mtime: null } as never);
    vi.mocked(readTextFile).mockImplementation(((path: string) =>
      Promise.resolve(`body of ${path}\n`)) as never);

    mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true }));
    });

    // The first file reuses the untouched Untitled tab; the second gets
    // its own. Two files in, two tabs out — not three.
    await waitFor(() => expect(screen.getByTestId("tab-count").textContent).toBe("2"));
    expect(screen.getByTestId("names").textContent).toBe("one.md,two.md");
    expect(active()).toBe("two.md");
  });

  it("opens the readable files when one of them fails", async () => {
    // One bad path out of two shouldn't sink the other.
    const { readTextFile, stat } = await import("@tauri-apps/plugin-fs");
    vi.mocked(open).mockResolvedValue(["/docs/good.md", "/docs/gone.md"] as never);
    vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, mtime: null } as never);
    vi.mocked(readTextFile).mockImplementation(((path: string) =>
      path.includes("gone")
        ? Promise.reject(new Error("ENOENT"))
        : Promise.resolve("good body\n")) as never);

    mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true }));
    });

    await waitFor(() => expect(screen.getByTestId("names").textContent).toContain("good.md"));
    expect(screen.getByTestId("names").textContent).not.toContain("gone.md");
  });
});
