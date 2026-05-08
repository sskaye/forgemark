import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

// Loose typing — these are test mocks. The renderer doesn't see
// these signatures; only Vitest's runtime matters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const saveDialogMock = vi.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const writeFileMock = vi.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchMock = vi.fn<(...args: any[]) => any>();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: (...args: unknown[]) => saveDialogMock(...(args as [])),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  writeFile: (...args: unknown[]) => writeFileMock(...(args as [])),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  window.localStorage.clear();
  // Skip first-run so Settings is reachable.
  window.localStorage.setItem("forgemark.firstRunDone", "true");
  saveDialogMock.mockReset();
  writeFileMock.mockClear();
  fetchMock.mockReset();
  // jsdom doesn't ship a fetch by default; install our mock.
  vi.stubGlobal("fetch", fetchMock);
});

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

describe("Phase 12 — skill download buttons", () => {
  it("Download for Claude writes the .skill bytes to the chosen path", async () => {
    saveDialogMock.mockResolvedValue("/Users/me/Downloads/forgemark-skill.skill");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer),
    });
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-claude"));
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledTimes(1);
    });
    // Path argument matches the dialog's chosen path.
    expect(writeFileMock.mock.calls[0][0]).toBe("/Users/me/Downloads/forgemark-skill.skill");
    // Bytes are a Uint8Array (the Tauri writeFile binary contract).
    expect(writeFileMock.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
  });

  it("Download for Codex uses the .zip bundle URL", async () => {
    saveDialogMock.mockResolvedValue("/Users/me/Downloads/forgemark-skill.zip");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer),
    });
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-codex"));
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledTimes(1);
    });
    // The fetched URL string ends with the .zip extension. (Vite's
    // ?url import resolves to a path; we just check the suffix to
    // avoid hard-coding internals.)
    const fetchedUrl = String(fetchMock.mock.calls[0][0]);
    expect(fetchedUrl.endsWith(".zip")).toBe(true);
  });

  it("Cancel from the save dialog is a silent no-op", async () => {
    saveDialogMock.mockResolvedValue(null);
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-claude"));
    await new Promise((r) => setTimeout(r, 0));
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fm-settings-skill-error")).not.toBeInTheDocument();
  });

  it("Helper text reads 'identical content; the extension is what your AI tool expects'", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    await screen.findByTestId("fm-settings-skill-claude");
    expect(screen.getByText(/identical content/i)).toBeInTheDocument();
  });

  it("Both buttons disable while a download is in flight", async () => {
    let resolveSave: (value: string) => void = () => {};
    saveDialogMock.mockImplementation(
      () => new Promise((r) => (resolveSave = r as (s: string) => void)),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-claude"));
    // Mid-flight: both buttons disabled.
    await waitFor(() => {
      const claude = screen.getByTestId("fm-settings-skill-claude") as HTMLButtonElement;
      expect(claude.disabled).toBe(true);
    });
    const codex = screen.getByTestId("fm-settings-skill-codex") as HTMLButtonElement;
    expect(codex.disabled).toBe(true);
    // Resolve the dialog so the test cleans up.
    resolveSave("/tmp/x.skill");
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalled();
    });
  });
});
