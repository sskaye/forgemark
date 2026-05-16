import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  window.localStorage.setItem("forgemark.firstRunDone", "true");
});

function HarnessProbe({
  body,
  comments = [],
  readOnly = false,
}: {
  body: string;
  comments?: Comment[];
  readOnly?: boolean;
}) {
  const { state, dispatch } = useDocument();
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
    dispatch({
      type: "load",
      filePath: "/tmp/find.md",
      fileName: "find.md",
      text: body,
      body,
      comments,
      readOnly,
    });
  }
  return (
    <div>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-dirty">{String(state.dirty)}</span>
    </div>
  );
}

function renderApp(body: string, opts: { readOnly?: boolean } = {}) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <HarnessProbe body={body} readOnly={opts.readOnly} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

describe("Find/Replace", () => {
  it("Cmd+F opens the bar and finds document text", async () => {
    renderApp("Alpha beta alpha\n");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(await screen.findByTestId("fm-findbar")).toBeInTheDocument();
    expect(screen.getByTestId("fm-findbar-toggle-replace")).toHaveAttribute("type", "checkbox");
    expect(screen.getByTestId("fm-findbar-toggle-replace")).not.toBeChecked();
    expect(screen.queryByTestId("fm-findbar-match-case")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("fm-findbar-query"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 2"));
    expect(document.querySelectorAll(".fm-search-match").length).toBe(2);
    expect(document.querySelector(".fm-search-match-active")).not.toBeNull();
  });

  it("Edit > Find/Replace event opens the same bar", async () => {
    renderApp("Alpha beta alpha\n");

    window.dispatchEvent(new CustomEvent("forgemark:menu", { detail: "find-replace" }));
    expect(await screen.findByTestId("fm-findbar")).toBeInTheDocument();
  });

  it("Cmd+Option+F opens replace mode and Replace All mutates body text", async () => {
    renderApp("Alpha beta alpha\n");

    fireEvent.keyDown(window, { key: "f", metaKey: true, altKey: true });
    expect(await screen.findByTestId("fm-findbar-toggle-replace")).toBeChecked();
    expect(await screen.findByTestId("fm-findbar-replacement")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("fm-findbar-query"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByTestId("fm-findbar-replacement"), {
      target: { value: "gamma" },
    });
    await waitFor(() => expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 2"));

    fireEvent.click(screen.getByTestId("fm-findbar-replace-all"));

    await waitFor(() =>
      expect(screen.getByTestId("probe-body")).toHaveTextContent("gamma beta gamma"),
    );
    expect(screen.getByTestId("probe-dirty")).toHaveTextContent("true");
  });

  it("Cmd+G and Cmd+Shift+G cycle through matches", async () => {
    renderApp("Alpha beta alpha\n");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.change(await screen.findByTestId("fm-findbar-query"), {
      target: { value: "alpha" },
    });
    await waitFor(() => expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 2"));

    fireEvent.keyDown(window, { key: "g", metaKey: true });
    expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("2 of 2");

    fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 2");
  });

  it("Cmd+E seeds find text from the current rendered selection", async () => {
    renderApp("Alpha beta alpha\n");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.change(await screen.findByTestId("fm-findbar-query"), {
      target: { value: "beta" },
    });
    await waitFor(() => expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 1"));
    fireEvent.change(screen.getByTestId("fm-findbar-query"), { target: { value: "" } });
    fireEvent.keyDown(window, { key: "e", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("fm-findbar-query")).toHaveValue("beta"));
  });

  it("disables replace controls for read-only documents", async () => {
    renderApp("Alpha beta alpha\n", { readOnly: true });

    fireEvent.keyDown(window, { key: "f", metaKey: true, altKey: true });
    fireEvent.change(await screen.findByTestId("fm-findbar-query"), {
      target: { value: "alpha" },
    });
    await waitFor(() => expect(screen.getByTestId("fm-findbar-count")).toHaveTextContent("1 of 2"));

    expect(screen.getByTestId("fm-findbar-replace")).toBeDisabled();
    expect(screen.getByTestId("fm-findbar-replace-all")).toBeDisabled();
  });
});
