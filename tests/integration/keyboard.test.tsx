import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { Comment } from "../../src/format/types";

// The keymap in practice: one chord means one thing, card shortcuts
// follow the keyboard focus, nothing fires over a dialog or into a text
// field, and tabs and cards can be reached without a mouse.

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

const comment = (id: number, over: Partial<Comment> = {}): Comment => ({
  id,
  anchor_text: `bit${id}`,
  author: "Maya",
  timestamp: `2026-05-07T09:0${id}:00Z`,
  resolved: false,
  body: `note ${id}\n`,
  ...over,
});

// Comment 2 has no markers: an orphan, which is what the Reattach dialog
// is for.
const BODY = "a <!-- fmc:1 -->bit1<!-- /fmc:1 --> b bit2 c\n";

function Probe() {
  const { workspace, dispatch } = useWorkspace();
  const active = workspace.docs[workspace.activeId];
  return (
    <div>
      <span data-testid="probe-active">{active.fileName}</span>
      <span data-testid="probe-focused">{String(active.focusedCommentId)}</span>
      <span data-testid="probe-resolved">
        {active.comments
          .filter((c) => c.resolved)
          .map((c) => c.id)
          .join(",")}
      </span>
      <span data-testid="probe-count">{active.comments.length}</span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/one.md",
            fileName: "one.md",
            text: BODY,
            body: BODY,
            comments: [comment(1), comment(2)],
            readOnly: false,
          })
        }
      />
      <button
        data-testid="probe-open-second"
        onClick={() =>
          dispatch({
            type: "openTab",
            initial: {
              filePath: "/tmp/two.md",
              fileName: "two.md",
              originalText: "two\n",
              body: "two\n",
              comments: [],
            },
          })
        }
      />
      <button
        data-testid="probe-focus-in-editor"
        onClick={() => dispatch({ type: "setFocusedComment", id: 1 })}
      />
      <button
        data-testid="probe-open-reattach"
        onClick={() => dispatch({ type: "openReattach", commentId: 2 })}
      />
    </div>
  );
}

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const key = (k: string, mods: Partial<KeyboardEventInit> = {}, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...mods }));
  });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

describe("one chord, one command", () => {
  it("⌘⇧E with a saved file and a focused own card opens only Clean Export", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    const card = await screen.findByTestId("fm-card-1");
    card.focus();
    await waitFor(() => expect(screen.getByTestId("probe-focused").textContent).toBe("1"));

    key("e", { metaKey: true, shiftKey: true });

    expect(await screen.findByTestId("fm-clean-export-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("fm-inline-composer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fm-findbar")).not.toBeInTheDocument();
  });
});

describe("card shortcuts follow the keyboard focus", () => {
  it("do nothing when the focused comment was set from the editor", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    await screen.findByTestId("fm-card-1");
    fireEvent.click(screen.getByTestId("probe-focus-in-editor"));
    expect(screen.getByTestId("probe-focused").textContent).toBe("1");
    (document.activeElement as HTMLElement | null)?.blur();

    key("Enter", { metaKey: true });
    key("Backspace");

    expect(screen.getByTestId("probe-resolved").textContent).toBe("");
    expect(screen.getByTestId("probe-count").textContent).toBe("2");
  });

  it("do nothing while a dialog is open", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    const card = await screen.findByTestId("fm-card-1");
    card.focus();
    fireEvent.click(screen.getByTestId("probe-open-reattach"));
    expect(await screen.findByTestId("fm-reattach-modal")).toBeInTheDocument();

    key("Backspace");

    expect(screen.getByTestId("probe-count").textContent).toBe("2");
    expect(screen.getByTestId("fm-reattach-modal")).toBeInTheDocument();
  });

  it("do nothing while typing", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    const card = await screen.findByTestId("fm-card-1");
    card.focus();
    const ta = document.createElement("textarea");
    card.appendChild(ta);
    ta.focus();

    key("Enter", { metaKey: true }, ta);
    key("e", {}, ta);

    expect(screen.getByTestId("probe-resolved").textContent).toBe("");
    expect(screen.queryByTestId("fm-inline-composer")).not.toBeInTheDocument();
  });

  it("↑ and ↓ move between cards, and the reducer follows", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    await screen.findByTestId("fm-card-1");
    // Cards in the order the sidebar shows them (orphans are grouped).
    const cards = screen.getAllByTestId(/^fm-card-\d+$/);
    const idOf = (el: HTMLElement) => el.getAttribute("data-anchor-card-id");
    await act(async () => cards[0].focus());
    await waitFor(() =>
      expect(screen.getByTestId("probe-focused").textContent).toBe(idOf(cards[0])),
    );

    key("ArrowDown");
    await waitFor(() => expect(document.activeElement).toBe(cards[1]));
    expect(screen.getByTestId("probe-focused").textContent).toBe(idOf(cards[1]));

    key("ArrowUp");
    await waitFor(() => expect(document.activeElement).toBe(cards[0]));
    expect(screen.getByTestId("probe-focused").textContent).toBe(idOf(cards[0]));
  });
});

describe("tabs from the keyboard", () => {
  it("⌘⇧] and ⌘⇧[ cycle, ⌘1 jumps, arrows walk the strip", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    fireEvent.click(screen.getByTestId("probe-open-second"));
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("two.md"));

    key("]", { metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("one.md"));
    key("[", { metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("two.md"));
    key("1", { metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("one.md"));

    const tabs = screen.getAllByRole("tab", { name: /\.md/ });
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("two.md"));
    expect(document.activeElement).toBe(screen.getAllByRole("tab", { name: /\.md/ })[1]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("one.md"));
  });
});
