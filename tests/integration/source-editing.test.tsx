// Editing a document as text, in Source view.
//
// The text is the user's while they type: the sidebar reads it
// tolerantly, a save writes it verbatim, and leaving Source view parses
// it for real. Rendered-view editing is untouched by any of this and
// keeps its own tests.

import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";
import { renderApp, fakeTauri } from "../utils/harness";
import { useDocument } from "../../src/state/DocumentProvider";
import type { Comment } from "../../src/format/types";

const BODY =
  "# Heading\n\nSome prose with <!-- fmc:1 -->an anchored passage<!-- /fmc:1 --> here.\n";
const COMMENTS: Comment[] = [
  {
    id: 1,
    author: "Maya",
    timestamp: "2026-05-07T09:00:00Z",
    resolved: false,
    anchor_text: "an anchored passage",
    body: "looks good\n",
  },
];

function Probe() {
  const { state } = useDocument();
  return (
    <div>
      <span data-testid="probe-view-mode">{state.viewMode}</span>
      <span data-testid="probe-dirty">{String(state.dirty)}</span>
      <span data-testid="probe-draft">{state.sourceDraft == null ? "none" : "draft"}</span>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-ids">{state.comments.map((c) => c.id).join(",")}</span>
      <span data-testid="probe-error">{state.error ?? ""}</span>
      <span data-testid="probe-generation">{state.loadGeneration}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

function sourceView(): EditorView {
  const host = screen.getByTestId("fm-source-view") as HTMLElement & {
    __forgemarkSourceView?: EditorView;
  };
  if (!host.__forgemarkSourceView) throw new Error("source view not mounted");
  return host.__forgemarkSourceView;
}

// Type by replacing text in the CodeMirror document, which reaches the
// pane the way keystrokes do.
async function typeInSource(find: string | RegExp, replacement: string) {
  const view = sourceView();
  const text = view.state.doc.toString();
  const m = typeof find === "string" ? { index: text.indexOf(find), 0: find } : text.match(find);
  if (!m || m.index == null || m.index < 0) throw new Error(`not in source: ${find}`);
  const at = m.index;
  await act(async () => {
    view.dispatch({ changes: { from: at, to: at + m[0].length, insert: replacement } });
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function openInSource(opts: { readOnly?: boolean } = {}) {
  renderApp({
    load: { filePath: "/tmp/x.md", body: BODY, comments: COMMENTS, readOnly: opts.readOnly },
    probe: <Probe />,
  });
  fireEvent.click(screen.getByRole("tab", { name: "Source" }));
  await waitFor(() => expect(screen.getByTestId("fm-source-view")).toBeInTheDocument());
}

describe("editing in Source view", () => {
  it("is offered for a writable file and refused for a read-only one", async () => {
    await openInSource();
    expect(screen.getByTestId("fm-source-chip").textContent).toContain("editable");
    expect(sourceView().state.facet((await import("@codemirror/state")).EditorState.readOnly)).toBe(
      false,
    );
  });

  it("stays read-only for a read-only file", async () => {
    await openInSource({ readOnly: true });
    expect(screen.getByTestId("fm-source-chip").textContent).toContain("read-only");
    expect(sourceView().state.facet((await import("@codemirror/state")).EditorState.readOnly)).toBe(
      true,
    );
  });

  it("keeps what is typed as a draft, and the sidebar reads it", async () => {
    await openInSource();
    await typeInSource("Some prose", "Much prose");
    expect(screen.getByTestId("probe-draft").textContent).toBe("draft");
    expect(screen.getByTestId("probe-dirty").textContent).toBe("true");
    expect(screen.getByTestId("probe-body").textContent).toContain("Much prose");
    expect(screen.getByTestId("fm-card-1")).toBeInTheDocument();
  });

  it("saves the draft as typed", async () => {
    await openInSource();
    await typeInSource("Some prose", "Much prose");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(fakeTauri.fs.writeTextFile).toHaveBeenCalled());
    const written = String(fakeTauri.fs.writeTextFile.mock.calls.at(-1)?.[1]);
    expect(written).toBe(sourceView().state.doc.toString());
    expect(written).toContain("Much prose");
    await waitFor(() => expect(screen.getByTestId("probe-dirty").textContent).toBe("false"));
  });

  it("commits the draft on the way back to Rendered, markers and records included", async () => {
    await openInSource();
    const before = Number(screen.getByTestId("probe-generation").textContent);
    // A marker pair and its record, typed by hand.
    await typeInSource("here.", "<!-- fmc:2 -->here<!-- /fmc:2 -->.");
    await typeInSource(
      /\n(?=-->)/,
      "\n- id: 2\n  anchor_text: here\n  author: Maya\n  timestamp: 2026-05-07T09:05:00Z\n  resolved: false\n  body: |\n    and here\n",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Rendered" }));
    await waitFor(() => expect(screen.getByTestId("probe-view-mode").textContent).toBe("rendered"));
    expect(screen.getByTestId("probe-draft").textContent).toBe("none");
    expect(screen.getByTestId("probe-ids").textContent).toBe("1,2");
    expect(Number(screen.getByTestId("probe-generation").textContent)).toBe(before + 1);
    await waitFor(() =>
      expect(document.querySelector("[data-anchor-id='2']")?.textContent).toBe("here"),
    );
    expect(screen.getByTestId("fm-card-2")).toBeInTheDocument();
  });

  it("a comment deleted in Source, markers and record, takes its card with it", async () => {
    await openInSource();
    // The record alone leaves orphan markers, which the parser refuses;
    // the card stays until the markers go too.
    await typeInSource(/- id: 1\n[\s\S]*?(?=\n-->)/, "");
    expect(screen.getByTestId("fm-card-1")).toBeInTheDocument();
    await typeInSource("<!-- fmc:1 -->an anchored passage<!-- /fmc:1 -->", "an anchored passage");
    await waitFor(() => expect(screen.queryByTestId("fm-card-1")).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Rendered" }));
    await waitFor(() => expect(screen.getByTestId("probe-view-mode").textContent).toBe("rendered"));
    expect(screen.getByTestId("probe-ids").textContent).toBe("");
  });

  it("refuses to leave Source view with a comments block the parser cannot read", async () => {
    await openInSource();
    await typeInSource("  resolved: false\n", "  resolved: false\n  timestamp: twice\n");
    fireEvent.click(screen.getByRole("tab", { name: "Rendered" }));
    await waitFor(() =>
      expect(screen.getByTestId("probe-error").textContent).toMatch(/can't be read/),
    );
    expect(screen.getByTestId("probe-view-mode").textContent).toBe("source");
    expect(screen.getByTestId("probe-draft").textContent).toBe("draft");
  });

  it("does not move the caret when its own keystroke comes back", async () => {
    await openInSource();
    const view = sourceView();
    view.focus();
    await typeInSource("Some prose", "Much prose");
    // The prop round-trip carries the same text; the view is untouched.
    expect(view.state.doc.toString()).toContain("Much prose");
    expect(screen.getByTestId("probe-body").textContent).toContain("Much prose");
  });
});

const REPORT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Report</title></head>
<body>
<p>Opening <!-- fmc:1 -->remark<!-- /fmc:1 --> here.</p>
<p>Trailing prose.</p>
</body></html>
`;

describe("editing an HTML report in Source view", () => {
  it("reloads the frame with the change and keeps the comments", async () => {
    renderApp({
      load: {
        filePath: "/tmp/report.html",
        body: REPORT,
        format: "html",
        comments: [
          {
            id: 1,
            author: "Maya",
            timestamp: "2026-05-07T09:00:00Z",
            resolved: false,
            anchor_text: "remark",
            body: "hm\n",
          },
        ],
      },
      probe: <Probe />,
    });
    const frameText = () =>
      document.querySelector<HTMLIFrameElement>("[data-testid='fm-html-view']")?.contentDocument
        ?.body?.textContent ?? "";
    await waitFor(() => expect(frameText()).toContain("Trailing prose."));
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    await waitFor(() => expect(screen.getByTestId("fm-source-view")).toBeInTheDocument());
    expect(screen.getByTestId("fm-source-chip").textContent).toContain("editable");
    await typeInSource("Trailing prose.", "Trailing text, edited.");
    fireEvent.click(screen.getByRole("tab", { name: "Rendered" }));
    await waitFor(() => expect(screen.getByTestId("probe-view-mode").textContent).toBe("rendered"));
    await waitFor(() => expect(frameText()).toContain("Trailing text, edited."));
    expect(screen.getByTestId("probe-ids").textContent).toBe("1");
    expect(screen.getByTestId("fm-card-1")).toBeInTheDocument();
    await waitFor(() => expect(frameText()).not.toContain("<!-- fmc:1 -->"));
  });
});
