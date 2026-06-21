// Bug 4 / report Bug 1 (overlap): when a new-comment selection overlaps an
// existing comment, EditorPane opens an OverlapPrompt instead of the
// new-comment composer. "Reply" routes into the existing comment's inline
// reply composer; "Cancel" dismisses.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { DocumentBindings } from "../../src/state/DocumentBindings";
import { AppShell } from "../../src/components/AppShell";
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

function StateProbe() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="probe-composer-mode">{state.composer?.mode ?? "none"}</span>
      <span data-testid="probe-focused">{state.focusedCommentId ?? "none"}</span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/x.md",
            fileName: "x.md",
            text: "Hello world anchored here.\n",
            body: "Hello world <!-- fmc:1 -->anchored<!-- /fmc:1 --> here.\n",
            comments: [
              {
                id: 1,
                anchor_text: "anchored",
                context_before: "Hello world ",
                context_after: " here.",
                author: "Maya",
                timestamp: "2026-05-08T00:00:00Z",
                resolved: false,
                body: "First note.",
              },
            ],
            readOnly: false,
          })
        }
      />
      <button
        data-testid="probe-open-overlap"
        onClick={() =>
          dispatch({
            type: "openComposer",
            composer: { mode: "overlapPrompt", targetCommentId: 1, x: 10, y: 20 },
          })
        }
      />
    </div>
  );
}

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <DocumentBindings />
        <AppShell />
        <StateProbe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("overlap prompt", () => {
  it("Reply routes the overlap into the existing comment's reply composer", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    fireEvent.click(screen.getByTestId("probe-open-overlap"));

    expect(screen.getByTestId("fm-overlap-prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fm-overlap-prompt-reply"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-composer-mode").textContent).toBe("reply");
    });
    expect(screen.getByTestId("probe-focused").textContent).toBe("1");
    // The inline reply composer is now mounted on comment 1's card.
    expect(screen.getByTestId("fm-inline-composer")).toBeInTheDocument();
  });

  it("Cancel dismisses the prompt without creating anything", async () => {
    renderApp();
    fireEvent.click(screen.getByTestId("probe-load"));
    fireEvent.click(screen.getByTestId("probe-open-overlap"));

    expect(screen.getByTestId("fm-overlap-prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fm-overlap-prompt-cancel"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-composer-mode").textContent).toBe("none");
    });
    expect(screen.queryByTestId("fm-overlap-prompt")).not.toBeInTheDocument();
  });
});
