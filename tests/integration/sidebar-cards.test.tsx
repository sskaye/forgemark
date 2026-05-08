import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { DocumentBindings } from "../../src/state/DocumentBindings";
import { AppShell } from "../../src/components/AppShell";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
}));

const FIXTURE_PATH = resolve(__dirname, "..", "ai", "fixtures", "01-simple.md");
const FIXTURE = readFileSync(FIXTURE_PATH, "utf-8");

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";

const mockOpen = vi.mocked(open);
const mockReadTextFile = vi.mocked(readTextFile);
const mockStat = vi.mocked(stat);

beforeEach(() => {
  mockOpen.mockReset();
  mockReadTextFile.mockReset();
  mockStat.mockReset();
});

function FocusProbe() {
  const { state } = useDocument();
  return (
    <div>
      <span data-testid="probe-focused">{state.focusedCommentId ?? "none"}</span>
      <span data-testid="probe-hovered">{state.hoveredCommentId ?? "none"}</span>
    </div>
  );
}

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <DocumentBindings />
        <AppShell />
        <FocusProbe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

async function loadFixture() {
  mockOpen.mockResolvedValue(FIXTURE_PATH);
  // We only inspect a few of FileInfo's fields; cast loosely to keep the
  // test focused.
  mockStat.mockResolvedValue({ isDirectory: false, readonly: false } as never);
  mockReadTextFile.mockResolvedValue(FIXTURE);
  renderApp();
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true }));
  });
  await waitFor(() => {
    expect(screen.getByText("01-simple.md")).toBeInTheDocument();
  });
}

describe("sidebar / card / anchor synchronisation (Phase 4)", () => {
  it("renders one card per parsed comment", async () => {
    await loadFixture();
    expect(screen.getByTestId("fm-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("fm-card-2")).toBeInTheDocument();
  });

  it("cards appear in document order (1 before 2)", async () => {
    await loadFixture();
    const card1 = screen.getByTestId("fm-card-1");
    const card2 = screen.getByTestId("fm-card-2");
    expect(card1.compareDocumentPosition(card2)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders an anchor span per comment", async () => {
    await loadFixture();
    await waitFor(() => {
      const anchors = document.querySelectorAll("[data-anchor-id]");
      expect(anchors.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("clicking a card focuses both the card and the matching anchor", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-1");
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByTestId("probe-focused").textContent).toBe("1");
    });
    // Anchor span gets the is-focused class via the imperative effect.
    await waitFor(() => {
      const anchor = document.querySelector("[data-anchor-id='1']");
      expect(anchor?.classList.contains("is-focused")).toBe(true);
    });
  });

  it("hovering a card sets the hovered comment id", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-2");
    fireEvent.mouseEnter(card);
    await waitFor(() => {
      expect(screen.getByTestId("probe-hovered").textContent).toBe("2");
    });
    fireEvent.mouseLeave(card);
    await waitFor(() => {
      expect(screen.getByTestId("probe-hovered").textContent).toBe("none");
    });
  });

  it("Enter on a focused card dispatches focus", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-1");
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("probe-focused").textContent).toBe("1");
    });
  });

  it("Space on a focused card dispatches focus", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-2");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => {
      expect(screen.getByTestId("probe-focused").textContent).toBe("2");
    });
  });

  it("cards have role=button and tabIndex=0 (keyboard reachable)", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-1");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
  });

  it("card aria-label includes author and a body preview", async () => {
    await loadFixture();
    const card = screen.getByTestId("fm-card-1");
    const label = card.getAttribute("aria-label") ?? "";
    expect(label).toContain("Claude");
    expect(label).toContain("sample composition");
  });
});
