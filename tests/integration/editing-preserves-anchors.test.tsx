import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { Comment } from "../../src/format";
import { typeIntoEditor, editorText } from "../utils/typing";

vi.mock("../../src/services/fileIO", () => ({
  openDocument: vi.fn(),
  readDocument: vi.fn(),
  saveDocument: vi.fn(),
}));

// Comments live inside the markdown as `<!-- fmc:N -->` marker pairs, and
// every keystroke round-trips the whole body out of Tiptap and back. So
// editing elsewhere in the document must leave those markers intact — if
// a marker is dropped, its comment silently becomes an orphan and the
// file on disk quietly loses review data.
//
// The format layer is heavily unit-tested, but nothing drove this through
// a real keystroke in the rendered editor until now.

const BODY = [
  "Alpha <!-- fmc:1 -->anchored phrase<!-- /fmc:1 --> omega.",
  "",
  "Second paragraph, safe to edit.",
  "",
].join("\n");

const COMMENTS: Comment[] = [
  {
    id: 1,
    anchor_text: "anchored phrase",
    context_before: "Alpha ",
    context_after: " omega.",
    author: "Reviewer",
    timestamp: "2026-01-01T00:00:00Z",
    resolved: false,
    body: "Worth a look.",
  },
];

function Probe() {
  const { state, dispatch } = useDocument();
  return (
    <div>
      <span data-testid="body">{state.body}</span>
      <span data-testid="comment-count">{state.comments.length}</span>
      <button
        data-testid="load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/annotated.md",
            fileName: "annotated.md",
            text: BODY,
            body: BODY,
            comments: COMMENTS,
            readOnly: false,
          })
        }
      />
    </div>
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

describe("typing preserves comment anchors", () => {
  it("keeps the marker pair when editing a different paragraph", async () => {
    const { container } = mount();
    await act(async () => {
      screen.getByTestId("load").click();
    });
    await waitFor(() => expect(editorText(container)).toContain("anchored phrase"));
    expect(screen.getByTestId("comment-count").textContent).toBe("1");

    // Second paragraph — deliberately not the one carrying the anchor.
    typeIntoEditor(container, "Second paragraph, now edited.", 1);

    await waitFor(() => expect(screen.getByTestId("body").textContent).toContain("now edited"));

    const body = screen.getByTestId("body").textContent ?? "";
    expect(body).toContain("<!-- fmc:1 -->");
    expect(body).toContain("<!-- /fmc:1 -->");
    expect(body).toContain("anchored phrase");
    // The comment record itself must survive the edit too.
    expect(screen.getByTestId("comment-count").textContent).toBe("1");
  });
});
