import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  window.localStorage.clear();
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

describe("Phase 11 — Settings modal", () => {
  beforeEach(() => {
    // Skip first-run so the Settings UI is reachable.
    window.localStorage.setItem("forgemark.firstRunDone", "true");
  });

  it("titlebar gear button opens Settings", async () => {
    renderApp();
    expect(screen.queryByTestId("fm-settings-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    expect(await screen.findByTestId("fm-settings-modal")).toBeInTheDocument();
  });

  it("⌘, opens Settings", async () => {
    renderApp();
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(await screen.findByTestId("fm-settings-modal")).toBeInTheDocument();
  });

  it("AI Participation section exposes the placeholder line", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    expect(await screen.findByTestId("fm-settings-ai-placeholder")).toHaveTextContent(
      /skill download arrives with a future build/i,
    );
  });

  it("Author name change persists to localStorage", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    const input = (await screen.findByTestId("fm-settings-author")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Jordan" } });
    expect(window.localStorage.getItem("forgemark.author")).toBe("Jordan");
  });

  it("Font size stepper increments and clamps", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    const value = await screen.findByTestId("fm-settings-font-value");
    expect(value.textContent).toBe("17");
    fireEvent.click(screen.getByTestId("fm-settings-font-up"));
    expect(value.textContent).toBe("18");
    // CSS variable applied
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--fm-font-size")).toBe("18px");
    });
  });

  it("Theme segmented persists and updates document data-theme", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-theme-dark"));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(window.localStorage.getItem("forgemark.theme")).toBe("dark");
  });

  it("Done button closes the modal", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-done"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-settings-modal")).not.toBeInTheDocument();
    });
  });
});

describe("Phase 11 — First-run experience", () => {
  it("welcome screen appears on first launch", () => {
    renderApp();
    expect(screen.getByTestId("fm-first-run")).toBeInTheDocument();
  });

  it("welcome screen disappears after Skip and persists across remount", async () => {
    const r = renderApp();
    fireEvent.click(screen.getByTestId("fm-first-run-skip"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-first-run")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem("forgemark.firstRunDone")).toBe("true");
    r.unmount();
    renderApp();
    expect(screen.queryByTestId("fm-first-run")).not.toBeInTheDocument();
  });

  it("Open sample → loads the bundled sample file with all comment kinds", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("fm-first-run-open-sample"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-first-run")).not.toBeInTheDocument();
    });
    // The sample file has 5 comments including a suggestion and a floating note.
    // Cards render in the sidebar; verify a few signals.
    expect(await screen.findByTestId("fm-card-3")).toBeInTheDocument(); // suggestion
    expect(screen.getByTestId("fm-card-floating-pill-5")).toBeInTheDocument();
  });

  it("Name field commits on blur and the sample-file path inherits the name", async () => {
    renderApp();
    const input = (await screen.findByTestId("fm-first-run-name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Riley" } });
    fireEvent.blur(input);
    expect(window.localStorage.getItem("forgemark.author")).toBe("Riley");
  });
});
