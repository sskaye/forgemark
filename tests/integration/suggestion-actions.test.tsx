import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { Comment } from "../../src/format/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

function aSuggestion(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    author: "Maya",
    timestamp: "2026-05-07T09:00:00Z",
    resolved: false,
    anchor_text: "old phrase",
    suggested_edit: { from: "old phrase", to: "new phrase" },
    body: "tighter wording",
    ...overrides,
  };
}

function HarnessProbe({ initial }: { initial: { body: string; comments: Comment[] } }) {
  const { state, dispatch } = useDocument();
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
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
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-comment-count">{state.comments.length}</span>
      <span data-testid="probe-error">{state.error ?? "none"}</span>
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
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

describe("Suggested-edit cards", () => {
  it("renders the from→to block instead of a plain body", async () => {
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    expect(screen.getByTestId("fm-card-suggestion")).toBeInTheDocument();
  });

  it("focused suggestion card shows Accept and Reject (not Reply / Resolve)", async () => {
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByTestId("fm-card-accept-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fm-card-reject-1")).toBeInTheDocument();
    // Reply and Resolve are hidden on suggestion cards.
    expect(screen.queryByTestId("fm-card-reply-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fm-card-resolve-1")).not.toBeInTheDocument();
  });

  it("Accept replaces the anchored text and removes the comment", async () => {
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-accept-1"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-comment-count").textContent).toBe("0");
    });
    expect(screen.getByTestId("probe-body").textContent).toBe("x new phrase y\n");
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
  });

  it("Reject leaves the anchored text but removes the comment + markers", async () => {
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-reject-1"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-comment-count").textContent).toBe("0");
    });
    // The anchored text stays; only the markers are stripped.
    expect(screen.getByTestId("probe-body").textContent).toBe("x old phrase y\n");
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
  });

  it("Accept on a `from` mismatch routes to an error (lost-anchor in Phase 9)", async () => {
    // Body's anchored text drifted from the suggestion's `from`.
    renderApp({
      body: "x <!-- fmc:1 -->the new phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-accept-1"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-error").textContent).toMatch(/anchor/i);
    });
    // The comment is preserved (no terminal action taken).
    expect(screen.getByTestId("probe-comment-count").textContent).toBe("1");
  });

  it("⌘R on a focused suggestion is a no-op", async () => {
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [aSuggestion()],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", metaKey: true }));
    });
    // No reply composer appears.
    expect(screen.queryByTestId("fm-inline-composer")).not.toBeInTheDocument();
  });

  it("a suggestion with body=undefined renders without the body div", async () => {
    const c = aSuggestion();
    delete c.body;
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [c],
    });
    const card = await screen.findByTestId("fm-card-1");
    expect(card.querySelector(".fm-card-body")).toBeNull();
    // The from→to strip is still present.
    expect(screen.getByTestId("fm-card-suggestion")).toBeInTheDocument();
  });

  it("a suggestion with replies parses + serializes; UI hides Reply but the field round-trips", async () => {
    // We don't directly check serialization here (covered by round-trip
    // tests). What we verify: the UI doesn't surface Reply, and the
    // existing replies array on the suggestion is preserved through
    // load. (Actual round-trip parity for fixtures with this shape is
    // covered by the format-layer tests.)
    const c = aSuggestion({
      replies: [
        {
          author: "Claude",
          timestamp: "2026-05-07T10:00:00Z",
          body: "ack\n",
        },
      ],
    });
    renderApp({
      body: "x <!-- fmc:1 -->old phrase<!-- /fmc:1 --> y\n",
      comments: [c],
    });
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    expect(screen.queryByTestId("fm-card-reply-1")).not.toBeInTheDocument();
    // Replies inline are still rendered (so users can read what was said).
    expect(screen.getByTestId("fm-card-replies")).toBeInTheDocument();
  });
});

describe("Composer Suggest-edit toggle", () => {
  it("flips the textarea into Original + Replacement fields", async () => {
    // Empty document; user opens composer via dispatch directly so we
    // don't need a real selection in jsdom.
    function ToggleProbe() {
      const { dispatch } = useDocument();
      return (
        <button
          data-testid="probe-open-composer"
          onClick={() =>
            dispatch({
              type: "openComposer",
              composer: {
                mode: "new",
                from: 0,
                to: 5,
                selectionText: "old phrase",
                contextBefore: "",
                contextAfter: "",
                x: 10,
                y: 20,
              },
            })
          }
        />
      );
    }
    render(
      <ThemeProvider initialPreference="light">
        <DocumentProvider>
          <AppShell />
          <ToggleProbe />
        </DocumentProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("probe-open-composer"));
    expect(await screen.findByTestId("fm-composer")).toBeInTheDocument();
    // Default is comment mode.
    expect(screen.queryByTestId("fm-composer-original")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fm-composer-suggest-toggle"));
    // Suggest mode — Original shown, Replacement editable.
    expect(await screen.findByTestId("fm-composer-original")).toHaveTextContent("old phrase");
    expect(screen.getByTestId("fm-composer-replacement")).toBeInTheDocument();
  });

  it("Suggest submit is disabled until the replacement is non-empty", async () => {
    function ToggleProbe() {
      const { dispatch } = useDocument();
      return (
        <button
          data-testid="probe-open-composer"
          onClick={() =>
            dispatch({
              type: "openComposer",
              composer: {
                mode: "new",
                from: 0,
                to: 5,
                selectionText: "old phrase",
                contextBefore: "",
                contextAfter: "",
                x: 10,
                y: 20,
              },
            })
          }
        />
      );
    }
    render(
      <ThemeProvider initialPreference="light">
        <DocumentProvider>
          <AppShell />
          <ToggleProbe />
        </DocumentProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("probe-open-composer"));
    fireEvent.click(await screen.findByTestId("fm-composer-suggest-toggle"));
    const submit = (await screen.findByTestId("fm-composer-submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const replacement = screen.getByTestId("fm-composer-replacement") as HTMLTextAreaElement;
    fireEvent.change(replacement, { target: { value: "new phrase" } });
    expect((screen.getByTestId("fm-composer-submit") as HTMLButtonElement).disabled).toBe(false);
  });
});
