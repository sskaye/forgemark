import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useDocument } from "../../src/state/DocumentProvider";
import { renderApp as mount } from "../utils/harness";
import { saveDocument } from "../../src/services/fileIO";
import { invoke } from "@tauri-apps/api/core";
import type { Comment } from "../../src/format/types";

// The small things a reviewer met every session, each pinned.

vi.mock("../../src/services/fileIO", () => ({
  openDocument: vi.fn(),
  openDocuments: vi.fn(),
  readDocument: vi.fn(),
  saveDocument: vi.fn(),
}));

const comment = (id: number, over: Partial<Comment> = {}): Comment => ({
  id,
  anchor_text: `p${id}`,
  author: "Maya",
  timestamp: `2026-05-07T09:0${id}:00Z`,
  resolved: false,
  body: `note ${id}\n`,
  ...over,
});

let currentBody = "";
let currentComments: Comment[] = [];

function Probe({ body, comments }: { body: string; comments: Comment[] }) {
  const { state, dispatch } = useDocument();
  const [loaded] = [state.filePath === "/tmp/doc.md"];
  if (!loaded) {
    dispatch({
      type: "load",
      filePath: "/tmp/doc.md",
      fileName: "doc.md",
      text: body,
      body,
      comments,
      readOnly: false,
    });
  }
  currentBody = state.body;
  currentComments = state.comments;
  return (
    <div>
      <span data-testid="probe-filter">{JSON.stringify(state.filter)}</span>
      <button
        data-testid="probe-open-composer"
        onClick={() =>
          dispatch({
            type: "openComposer",
            composer: {
              mode: "new",
              from: 1,
              to: 3,
              selectionText: "p1",
              contextBefore: "",
              contextAfter: "",
              x: 10,
              y: 20,
            },
          })
        }
      />
      <button
        data-testid="probe-filter-devon"
        onClick={() =>
          dispatch({ type: "setFilter", filter: { kind: "byAuthor", author: "Devon" } })
        }
      />
      <button
        data-testid="probe-reply-composer"
        onClick={() =>
          dispatch({ type: "openComposer", composer: { mode: "reply", commentId: 1 } })
        }
      />
    </div>
  );
}

function renderApp(body: string, comments: Comment[]) {
  return mount({ probe: <Probe body={body} comments={comments} /> });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
  vi.mocked(saveDocument).mockReset().mockResolvedValue("/tmp/out.md");
  vi.mocked(invoke).mockClear().mockResolvedValue(undefined);
});

describe("printing", () => {
  it("unmounts the hidden print editor once printing has been handed off", async () => {
    renderApp("hello\n", []);
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const modal = await screen.findByTestId("fm-print-options-modal");
    fireEvent.click(
      modal.querySelector(
        "button[type='submit'], [data-testid='fm-print-continue']",
      ) as HTMLElement,
    );
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("print_current_webview"));
    await waitFor(() => expect(screen.queryByTestId("fm-print-document")).not.toBeInTheDocument());
  });
});

describe("the comment card", () => {
  it("shows code identifiers in a body as written", async () => {
    renderApp("x <!-- fmc:1 -->p1<!-- /fmc:1 --> y\n", [
      comment(1, { body: "Rename `snake_case_name`; a * b * c stays.\n" }),
    ]);
    const card = await screen.findByTestId("fm-card-1");
    expect(card.textContent).toContain("snake_case_name");
    expect(card.textContent).toContain("a * b * c");
  });
});

describe("Doc order", () => {
  it("sorts by where the anchor sits, not by id", async () => {
    // Comment 2 was made later but anchors earlier in the document.
    renderApp("a <!-- fmc:2 -->p2<!-- /fmc:2 --> b <!-- fmc:1 -->p1<!-- /fmc:1 --> c\n", [
      comment(1),
      comment(2),
    ]);
    await screen.findByTestId("fm-card-1");
    const cards = screen
      .getAllByTestId(/^fm-card-\d+$/)
      .map((el) => el.getAttribute("data-testid"));
    expect(cards).toEqual(["fm-card-2", "fm-card-1"]);
  });
});

describe("Clean Export", () => {
  it("proposes <name>-clean.md", async () => {
    renderApp("hello\n", [comment(1, { floating: true, anchor_text: undefined })]);
    fireEvent.keyDown(window, { key: "e", metaKey: true, shiftKey: true });
    const modal = await screen.findByTestId("fm-clean-export-modal");
    const confirm = modal.querySelector("[data-testid='fm-clean-export-confirm']") as HTMLElement;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(vi.mocked(saveDocument)).toHaveBeenCalledWith(
        null,
        "hello\n",
        "markdown",
        "doc-clean.md",
      ),
    );
  });
});

describe("composer drafts", () => {
  it("survive a click outside the composer; an empty one still closes", async () => {
    renderApp("x <!-- fmc:1 -->p1<!-- /fmc:1 --> y\n", [comment(1)]);
    await screen.findByTestId("fm-card-1");
    fireEvent.click(screen.getByTestId("probe-reply-composer"));
    const ta = (await screen.findByTestId("fm-inline-composer-textarea")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "half a thought" } });

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(screen.getByTestId("fm-inline-composer-textarea")).toHaveValue("half a thought");

    fireEvent.change(ta, { target: { value: "" } });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(screen.queryByTestId("fm-inline-composer-textarea")).not.toBeInTheDocument();
  });
});

describe("the author filter", () => {
  it("keeps showing a persisted author even when this file has none by them", async () => {
    renderApp("x <!-- fmc:1 -->p1<!-- /fmc:1 --> y\n", [comment(1)]);
    await screen.findByTestId("fm-card-1");
    fireEvent.click(screen.getByTestId("probe-filter-devon"));
    const select = screen.getByTestId("fm-sidebar-filter") as HTMLSelectElement;
    expect(select.value).toBe("byAuthor:Devon");
    expect(Array.from(select.options).map((o) => o.value)).toContain("byAuthor:Devon");
  });
});

describe("the selection toolbar", () => {
  it("stays away while the find bar is open", async () => {
    const { container } = renderApp("find me and find me again\n", []);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const query = await screen.findByTestId("fm-findbar-query");
    fireEvent.change(query, { target: { value: "find me" } });
    fireEvent.keyDown(window, { key: "g", metaKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-testid='fm-selection-toolbar']")).toBeNull();
    expect(currentBody).toBe("find me and find me again\n");
    expect(currentComments).toEqual([]);
  });
});
