import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { Comment } from "../../src/format/types";

// Phase 6 sidebar-action integration tests. The Tauri plugins are mocked
// because AppShell pulls in DocumentBindings.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  // Set author so "By me" filter and edit gating have a canonical value.
  window.localStorage.setItem("forgemark.author", "Maya");
});

const aComment = (id: number, overrides: Partial<Comment> = {}): Comment => ({
  id,
  author: "Maya",
  timestamp: "2026-05-07T09:00:00Z",
  resolved: false,
  body: "alpha\n",
  anchor_text: `text${id}`,
  ...overrides,
});

function HarnessProbe({ initial }: { initial: { body: string; comments: Comment[] } }) {
  const { state, dispatch } = useDocument();
  const loadedRef = useRef(false);
  // Inject the initial state once on mount. Subsequent renders (e.g.
  // after a delete clears comments) must NOT re-load — that would
  // resurrect deleted comments.
  if (!loadedRef.current) {
    loadedRef.current = true;
    dispatch({
      type: "load",
      filePath: "/tmp/x.md",
      fileName: "x.md",
      text: initial.body,
      body: initial.body,
      comments: initial.comments,
      readOnly: false,
    });
  }
  return (
    <div>
      <span data-testid="probe-comment-ids">{state.comments.map((c) => c.id).join(",")}</span>
      <span data-testid="probe-resolved-ids">
        {state.comments
          .filter((c) => c.resolved)
          .map((c) => c.id)
          .join(",")}
      </span>
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-focused">{state.focusedCommentId ?? "none"}</span>
    </div>
  );
}

function renderApp(initial: { body: string; comments: Comment[] }) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <HarnessProbe initial={initial} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

describe("FMCard action row", () => {
  it("shows Reply / Edit / Resolve / Delete on the focused own comment", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByTestId("fm-card-reply-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fm-card-edit-1")).toBeInTheDocument();
    expect(screen.getByTestId("fm-card-resolve-1")).toBeInTheDocument();
    expect(screen.getByTestId("fm-card-delete-1")).toBeInTheDocument();
  });

  it("hides Edit on a comment owned by someone else", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1, { author: "Devon" })],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByTestId("fm-card-reply-1")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("fm-card-edit-1")).not.toBeInTheDocument();
    // Delete is always visible.
    expect(screen.getByTestId("fm-card-delete-1")).toBeInTheDocument();
  });

  it("Reply opens the inline reply composer", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-reply-1"));
    expect(await screen.findByTestId("fm-inline-composer")).toBeInTheDocument();
  });

  it("Reply submission appends a Reply and dirties the doc", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-reply-1"));
    const ta = (await screen.findByTestId("fm-inline-composer-textarea")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByTestId("fm-inline-composer-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("fm-card-replies")).toBeInTheDocument();
    });
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
  });

  it("Edit opens the editor on the comment body and Save persists", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1, { body: "original\n" })],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-edit-1"));
    const ta = (await screen.findByTestId("fm-inline-composer-textarea")) as HTMLTextAreaElement;
    expect(ta.value).toBe("original\n");
    fireEvent.change(ta, { target: { value: "edited body" } });
    fireEvent.click(screen.getByTestId("fm-inline-composer-submit"));
    await waitFor(() => {
      expect(card.textContent).toMatch(/edited body/);
    });
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
    // The card now shows the edited indicator.
    expect(within(card).getByText("(edited)")).toBeInTheDocument();
  });

  it("Resolve toggles the resolved state and collapses the card", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-resolve-1"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-resolved-ids").textContent).toBe("1");
    });
    // Card is still focused, so it stays expanded; click outside to collapse.
    fireEvent.click(document.body);
  });

  it("Delete removes the comment and its inline marker pair", async () => {
    renderApp({
      body: "before <!-- fmc:1 -->bit<!-- /fmc:1 --> after\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-delete-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-card-1")).not.toBeInTheDocument();
    });
    // Body no longer contains the marker pair.
    expect(screen.getByTestId("probe-body").textContent).toBe("before bit after\n");
  });

  it("Cascade delete: deleting a parent with replies removes the replies too", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [
        aComment(1, {
          replies: [
            { author: "Claude", timestamp: "2026-05-07T10:00:00Z", body: "r1\n" },
            { author: "Devon", timestamp: "2026-05-07T11:00:00Z", body: "r2\n" },
          ],
        }),
      ],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-delete-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-card-1")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("probe-comment-ids").textContent).toBe("");
  });
});

describe("Sidebar filter + sort", () => {
  it("populates author filter dynamically", async () => {
    renderApp({
      body: "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->\n",
      comments: [aComment(1), aComment(2, { author: "Claude" })],
    });
    const filter = (await screen.findByTestId("fm-sidebar-filter")) as HTMLSelectElement;
    const optionTexts = Array.from(filter.querySelectorAll("option")).map(
      (o) => o.textContent ?? "",
    );
    expect(optionTexts).toContain("By Claude");
    expect(optionTexts).toContain("By me");
  });

  it("filtering by an author hides the others", async () => {
    renderApp({
      body: "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->\n",
      comments: [aComment(1), aComment(2, { author: "Claude" })],
    });
    const filter = (await screen.findByTestId("fm-sidebar-filter")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "byAuthor:Claude" } });
    await waitFor(() => {
      expect(screen.queryByTestId("fm-card-1")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("fm-card-2")).toBeInTheDocument();
  });

  it("sort by Newest reorders top-level cards by timestamp desc", async () => {
    renderApp({
      body: "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->\n",
      comments: [
        aComment(1, { timestamp: "2026-05-01T00:00:00Z" }),
        aComment(2, { timestamp: "2026-05-08T00:00:00Z" }),
      ],
    });
    const sort = (await screen.findByTestId("fm-sidebar-sort")) as HTMLSelectElement;
    fireEvent.change(sort, { target: { value: "newest" } });
    await waitFor(() => {
      const cards = screen.getAllByTestId(/fm-card-\d+/);
      expect(cards[0].getAttribute("data-testid")).toBe("fm-card-2");
      expect(cards[1].getAttribute("data-testid")).toBe("fm-card-1");
    });
  });
});

describe("Keyboard shortcuts on the focused card", () => {
  function press(key: string, opts: { meta?: boolean; shift?: boolean } = {}) {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          metaKey: opts.meta ?? false,
          shiftKey: opts.shift ?? false,
        }),
      );
    });
  }

  it("⌘R opens the reply composer on the focused card", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    press("r", { meta: true });
    expect(await screen.findByTestId("fm-inline-composer")).toBeInTheDocument();
  });

  it("⌘⏎ toggles resolved on the focused card", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    press("Enter", { meta: true });
    await waitFor(() => {
      expect(screen.getByTestId("probe-resolved-ids").textContent).toBe("1");
    });
  });

  it("⌘⇧E opens edit composer on own comment", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1, { body: "mine\n" })],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    press("e", { meta: true, shift: true });
    const ta = (await screen.findByTestId("fm-inline-composer-textarea")) as HTMLTextAreaElement;
    expect(ta.value).toBe("mine\n");
  });

  it("⌘⇧E is a no-op on someone else's comment", async () => {
    renderApp({
      body: "<!-- fmc:1 -->bit<!-- /fmc:1 -->\n",
      comments: [aComment(1, { author: "Devon" })],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    press("e", { meta: true, shift: true });
    // Composer doesn't open.
    expect(screen.queryByTestId("fm-inline-composer")).not.toBeInTheDocument();
  });

  it("Delete key removes the focused comment", async () => {
    renderApp({
      body: "before <!-- fmc:1 -->bit<!-- /fmc:1 --> after\n",
      comments: [aComment(1)],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    // Move focus off the card so isTypingTarget returns false.
    document.body.focus();
    press("Delete");
    await waitFor(() => {
      expect(screen.queryByTestId("fm-card-1")).not.toBeInTheDocument();
    });
  });
});
