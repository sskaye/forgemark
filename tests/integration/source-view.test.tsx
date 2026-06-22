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
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

function HarnessProbe({
  initial,
}: {
  initial: { body: string; comments: Comment[]; readOnly?: boolean };
}) {
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
      readOnly: initial.readOnly ?? false,
    });
  }
  return (
    <div>
      <span data-testid="probe-view-mode">{state.viewMode}</span>
      <span data-testid="probe-composer-mode">{state.composer?.mode ?? "none"}</span>
      <button
        data-testid="probe-set-source"
        onClick={() => dispatch({ type: "setViewMode", viewMode: "source" })}
      />
      <button
        data-testid="probe-set-rendered"
        onClick={() => dispatch({ type: "setViewMode", viewMode: "rendered" })}
      />
      <button
        data-testid="probe-focus-1"
        onClick={() => dispatch({ type: "setFocusedComment", id: 1 })}
      />
      <button
        data-testid="probe-reload-rendered"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/y.md",
            fileName: "y.md",
            text: "# new file\n",
            body: "# new file\n",
            comments: [],
            readOnly: false,
          })
        }
      />
    </div>
  );
}

function renderApp(initial: { body: string; comments: Comment[]; readOnly?: boolean }) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <HarnessProbe initial={initial} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const SAMPLE = {
  body: "# Heading\n\nSome prose with <!-- fmc:1 -->an anchored passage<!-- /fmc:1 --> here.\n",
  comments: [
    {
      id: 1,
      author: "Maya",
      timestamp: "2026-05-07T09:00:00Z",
      resolved: false,
      anchor_text: "an anchored passage",
      body: "looks good\n",
    },
  ] as Comment[],
};

describe("Source view (Phase 8)", () => {
  it("toggles to source mode and renders the source-view host", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    expect(await screen.findByTestId("fm-source-view")).toBeInTheDocument();
    // The rendered Tiptap host disappears.
    expect(screen.queryByTestId("fm-rendered-view")).not.toBeInTheDocument();
  });

  it("shows the editable chip when the file is writable, hidden in Rendered view", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const chip = await screen.findByTestId("fm-source-chip");
    expect(chip).toHaveTextContent(/Source view.*editable/i);
    expect(chip).toHaveAttribute("title");
    expect(chip.getAttribute("title")).toMatch(/Rendered/i);
    // Chip is hidden in Rendered view.
    fireEvent.click(screen.getByTestId("probe-set-rendered"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-source-chip")).not.toBeInTheDocument();
    });
  });

  it('shows the "read-only review" chip when the file is read-only', async () => {
    renderApp({ ...SAMPLE, readOnly: true });
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const chip = await screen.findByTestId("fm-source-chip");
    expect(chip).toHaveTextContent(/Source view.*read-only review/i);
  });

  it("the source editor is editable for a writable file and locked when read-only", async () => {
    const { unmount } = renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const host = await screen.findByTestId("fm-source-view");
    await waitFor(() => {
      expect(host.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    });
    unmount();

    renderApp({ ...SAMPLE, readOnly: true });
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const lockedHost = await screen.findByTestId("fm-source-view");
    await waitFor(() => {
      expect(lockedHost.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe(
        "false",
      );
    });
  });

  it("source view contains the raw body text including the markers", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const host = await screen.findByTestId("fm-source-view");
    // CodeMirror renders the doc inside `.cm-content`. We just assert
    // both the prose and a marker appear in the painted text — actual
    // dimming is exercised in the decorations test below.
    await waitFor(() => {
      expect(host.textContent ?? "").toContain("anchored passage");
    });
    expect(host.textContent ?? "").toContain("fmc:1");
  });

  it("dims marker comments via the fm-cm-marker decoration", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const host = await screen.findByTestId("fm-source-view");
    await waitFor(() => {
      expect(host.querySelectorAll(".fm-cm-marker").length).toBeGreaterThan(0);
    });
    // Each opening + closing marker yields one mark span; with one comment
    // we expect at least 2 (open + close).
    expect(host.querySelectorAll(".fm-cm-marker").length).toBeGreaterThanOrEqual(2);
  });

  it("tints the trailing comments block via fm-cm-trailing-block", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const host = await screen.findByTestId("fm-source-view");
    await waitFor(() => {
      expect(host.querySelector(".fm-cm-trailing-block")).not.toBeNull();
    });
  });

  it("⌘⌥M in source view is a no-op (no composer opens)", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    await screen.findByTestId("fm-source-view");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, altKey: true }));
    });
    // No composer opens.
    expect(screen.getByTestId("probe-composer-mode").textContent).toBe("none");
    expect(screen.queryByTestId("fm-composer")).not.toBeInTheDocument();
  });

  it("focusing a comment in source mode does not throw and keeps the source view mounted", async () => {
    // The actual scrolling math depends on layout (which jsdom doesn't
    // run), so we just verify the focus dispatch doesn't unmount the
    // source view or error.
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    const host = await screen.findByTestId("fm-source-view");
    fireEvent.click(screen.getByTestId("probe-focus-1"));
    expect(host).toBeInTheDocument();
  });

  it("view mode resets to Rendered on file open", async () => {
    renderApp(SAMPLE);
    fireEvent.click(screen.getByTestId("probe-set-source"));
    expect(screen.getByTestId("probe-view-mode").textContent).toBe("source");
    // Simulate opening another file.
    fireEvent.click(screen.getByTestId("probe-reload-rendered"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-view-mode").textContent).toBe("rendered");
    });
  });

  it("the Rendered/Source segmented control flips view mode", async () => {
    renderApp(SAMPLE);
    const capture = vi.fn();
    window.addEventListener("forgemark:capture-view-sync", capture);
    const sourceTab = screen.getByRole("tab", { name: "Source" });
    fireEvent.click(sourceTab);
    expect(await screen.findByTestId("fm-source-view")).toBeInTheDocument();
    expect(screen.getByTestId("probe-view-mode").textContent).toBe("source");
    expect(capture).toHaveBeenCalledTimes(1);
    expect((capture.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      from: "rendered",
      to: "source",
    });
    const renderedTab = screen.getByRole("tab", { name: "Rendered" });
    fireEvent.click(renderedTab);
    await waitFor(() => {
      expect(screen.getByTestId("probe-view-mode").textContent).toBe("rendered");
    });
    expect(capture).toHaveBeenCalledTimes(2);
    expect((capture.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({
      from: "source",
      to: "rendered",
    });
    window.removeEventListener("forgemark:capture-view-sync", capture);
  });
});
