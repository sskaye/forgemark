import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { AppShell } from "../../src/components/AppShell";
import { LAYOUT } from "../../src/theme/tokens";

function renderShell(preference: "light" | "dark" = "light") {
  return render(
    <ThemeProvider initialPreference={preference}>
      <AppShell />
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
    expect(screen.getByText("Untitled")).toBeInTheDocument();
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
});
