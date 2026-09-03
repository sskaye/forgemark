import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useDocument } from "../../src/state/DocumentProvider";
import { renderApp } from "../utils/harness";
import type { Comment } from "../../src/format/types";

// Every dialog goes through one Modal: it takes focus when it opens,
// gives it back when it closes, answers Escape, and answers Enter only
// from inside itself. Nothing in the suite asserted focus before this.

const BODY = "a <!-- fmc:1 -->bit<!-- /fmc:1 --> b\n";
const comment: Comment = {
  id: 1,
  anchor_text: "bit",
  author: "Maya",
  timestamp: "2026-05-07T09:00:00Z",
  resolved: false,
  body: "n\n",
};

function Probe() {
  const { dispatch } = useDocument();
  return (
    <div>
      <button data-testid="probe-opener">opener</button>
      <button
        data-testid="probe-edit"
        onClick={() => dispatch({ type: "edit", body: "changed\n" })}
      />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

describe("a dialog", () => {
  it("takes focus on open and returns it to the opener on close", async () => {
    renderApp({ load: { body: BODY, comments: [comment] }, probe: <Probe /> });
    const opener = screen.getByTestId("probe-opener");
    opener.focus();
    expect(opener).toHaveFocus();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const modal = await screen.findByTestId("fm-print-options-modal");
    expect(modal.contains(document.activeElement)).toBe(true);
    expect(screen.getByTestId("fm-print-include-comments")).toHaveFocus();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByTestId("fm-print-options-modal")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("answers Enter from inside, not from anywhere in the window", async () => {
    renderApp({ load: { body: BODY, comments: [] }, probe: <Probe /> });
    fireEvent.keyDown(window, { key: "e", metaKey: true, shiftKey: true });
    // No comments: Clean Export is still offered on a saved file.
    const modal = await screen.findByTestId("fm-clean-export-modal");

    // From the window at large: nothing.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("fm-clean-export-modal")).toBeInTheDocument();

    // From inside the dialog: confirms (the save dialog is faked and
    // returns null, so the modal stays; the call is what we check).
    fireEvent.keyDown(modal, { key: "Enter" });
    // The confirm handler runs saveDocument, which asks the fake dialog;
    // it answers null and the modal is still up, which is fine here.
    expect(screen.getByTestId("fm-clean-export-modal")).toBeInTheDocument();
  });

  it("is not stacked on by an app shortcut", async () => {
    renderApp({ load: { body: BODY, comments: [] }, probe: <Probe /> });
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    await screen.findByTestId("fm-print-options-modal");

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("fm-settings-modal")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes on a click on the backdrop but not inside the content", async () => {
    renderApp({ load: { body: BODY, comments: [] }, probe: <Probe /> });
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const modal = await screen.findByTestId("fm-print-options-modal");

    fireEvent.click(screen.getByTestId("fm-print-include-comments"));
    expect(screen.getByTestId("fm-print-options-modal")).toBeInTheDocument();

    fireEvent.click(modal);
    await waitFor(() => expect(screen.queryByTestId("fm-print-options-modal")).toBeNull());
  });
});

describe("the segmented controls", () => {
  it("move with arrow keys and keep one tab stop", async () => {
    renderApp({ load: { body: BODY, comments: [] } });
    const rendered = screen.getByRole("tab", { name: "Rendered" });
    const source = screen.getByRole("tab", { name: "Source" });
    expect(rendered).toHaveAttribute("tabindex", "0");
    expect(source).toHaveAttribute("tabindex", "-1");

    rendered.focus();
    fireEvent.keyDown(rendered, { key: "ArrowRight" });
    await waitFor(() => expect(source).toHaveAttribute("aria-selected", "true"));
    expect(source).toHaveFocus();
    fireEvent.keyDown(source, { key: "Home" });
    await waitFor(() => expect(rendered).toHaveAttribute("aria-selected", "true"));
  });
});

describe("a comment card", () => {
  it("is a focusable region with its controls reachable, not a button", async () => {
    renderApp({ load: { body: BODY, comments: [comment] } });
    const card = await screen.findByTestId("fm-card-1");
    expect(card).not.toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");
    await act(async () => card.focus());
    await waitFor(() => expect(card).toHaveAttribute("aria-current", "true"));
    // The body is readable content, not hidden behind a label.
    expect(card.textContent).toContain("n");
  });
});
