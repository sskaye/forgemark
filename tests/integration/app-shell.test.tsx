import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { LAYOUT } from "../../src/theme/tokens";
import type { Comment } from "../../src/format/types";
import { invoke } from "@tauri-apps/api/core";

// AppShell pulls in DocumentBindings which imports the Tauri plugins;
// they don't actually run unless we fire a keydown, but the module
// resolution still happens. Mock to a no-op so no test ever accidentally
// invokes the real APIs.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("No Tauri runtime in tests"))),
}));

function renderShell(
  preference: "light" | "dark" = "light",
  initialState?: { body: string; comments: Comment[]; fileName?: string },
) {
  return render(
    <ThemeProvider initialPreference={preference}>
      <DocumentProvider
        initialState={
          initialState
            ? {
                fileName: initialState.fileName ?? "print.md",
                body: initialState.body,
                comments: initialState.comments,
                originalText: initialState.body,
              }
            : undefined
        }
      >
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

describe("AppShell layout", () => {
  it("renders the title bar, editor pane, and sidebar", () => {
    renderShell();
    expect(screen.getByTestId("fm-titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("fm-editor-pane")).toBeInTheDocument();
    expect(screen.getByTestId("fm-sidebar")).toBeInTheDocument();
  });

  it("title bar shows the file name", () => {
    renderShell();
    expect(within(screen.getByTestId("fm-titlebar")).getByText("Untitled")).toBeInTheDocument();
  });

  it("sidebar header shows the comments title and counts placeholder", () => {
    renderShell();
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByText("0 open · 0 total")).toBeInTheDocument();
  });

  it("title bar exposes the view mode toggle", () => {
    renderShell();
    const tablist = screen.getByRole("tablist", { name: /view mode/i });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rendered" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "false");
  });

  it("renders in dark mode without throwing", () => {
    renderShell("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("layout constants match the design spec", () => {
    expect(LAYOUT.chromeHeight).toBe(44);
    expect(LAYOUT.sidebarWidth).toBe(320);
    expect(LAYOUT.documentMaxWidth).toBe(720);
    expect(LAYOUT.editorPadding).toEqual({ vertical: 32, horizontal: 48 });
  });

  it("Cmd+P opens print options and Continue invokes window.print", async () => {
    // What the print document holds at the moment printing runs; it is
    // unmounted afterwards, so the check happens inside the mock.
    let printed: { review: string; suggestion: boolean } | null = null;
    const print = vi.fn(() => {
      printed = {
        review: screen.getByTestId("fm-print-review").textContent ?? "",
        suggestion: screen.queryByTestId("fm-print-suggestion") != null,
      };
    });
    Object.defineProperty(window, "print", { value: print, configurable: true });
    renderShell("light", {
      body: "A paragraph with text.\n",
      comments: [
        {
          id: 1,
          author: "Maya",
          timestamp: "2026-05-07T09:00:00Z",
          resolved: false,
          anchor_text: "text",
          body: "Comment body",
        },
        {
          id: 2,
          author: "Claude",
          timestamp: "2026-05-07T09:01:00Z",
          resolved: false,
          anchor_text: "paragraph",
          suggested_edit: { from: "paragraph", to: "section" },
        },
      ],
    });

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(await screen.findByTestId("fm-print-options-modal")).toBeInTheDocument();
    expect(
      screen.queryByText("Choose what to include before the system print dialog opens."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("fm-print-include-comments")).toBeChecked();
    expect(screen.getByTestId("fm-print-include-suggestions")).toBeChecked();

    fireEvent.click(screen.getByTestId("fm-print-include-suggestions"));
    fireEvent.click(screen.getByTestId("fm-print-continue"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("print_current_webview"));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printed!.review).toContain("Comment body");
    expect(printed!.suggestion).toBe(false);
    // And the hidden print editor is gone once printing has run.
    await waitFor(() => expect(screen.queryByTestId("fm-print-document")).not.toBeInTheDocument());
  });

  it("Cmd+P still opens print options while find has focus", async () => {
    renderShell("light", {
      body: "Findable paragraph.\n",
      comments: [],
    });

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const query = await screen.findByTestId("fm-findbar-query");
    query.focus();

    fireEvent.keyDown(query, { key: "p", metaKey: true });

    expect(await screen.findByTestId("fm-print-options-modal")).toBeInTheDocument();
  });
});
