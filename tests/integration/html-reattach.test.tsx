// Recovering a review after the report was regenerated.
//
// The agent reruns, writes a whole new file, and every marker is gone.
// The comments survive in the trailing block, so the app has to put them
// back — and doing that one modal at a time turns a mechanical recovery
// into a dozen identical decisions.

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { classifyAnchors } from "../../src/format";
import type { Comment } from "../../src/format/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(() => Promise.resolve()),
  lstat: vi.fn(() => Promise.resolve({ isSymlink: false })),
  remove: vi.fn(() => Promise.resolve()),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

// A rebuilt report: same prose, no markers anywhere.
const REBUILT = `<!doctype html>
<html><head><title>Meals</title></head>
<body>
<p>Eliminating the linear block analytically is <b>variable projection</b>.</p>
<figure id="fig-3"><figcaption>Figure 4. Protein sensitivity</figcaption><svg viewBox="0 0 10 10"></svg></figure>
<p>The outer loop is a grid, then a golden-section polish.</p>
<p>Ambiguous sentence.</p>
<p>Ambiguous sentence.</p>
</body></html>
`;

const COMMENTS: Comment[] = [
  {
    id: 1,
    anchor_text: "variable projection",
    author: "Claude",
    timestamp: "2026-08-16T09:00:00Z",
    resolved: false,
    body: "Gloss this.",
  },
  {
    id: 2,
    anchor_text: "Figure 3. Protein sensitivity",
    anchor_kind: "element",
    anchor_selector: "#fig-3",
    author: "Sam",
    timestamp: "2026-08-16T09:05:00Z",
    resolved: false,
    body: "Axis label is cut off.",
  },
  {
    id: 3,
    anchor_text: "Ambiguous sentence.",
    author: "Sam",
    timestamp: "2026-08-16T09:06:00Z",
    resolved: false,
    body: "Which one?",
  },
];

function Harness() {
  const { state, dispatch } = useDocument();
  const statuses = classifyAnchors(state.body, state.comments, state.format);
  return (
    <div>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-attached">
        {state.comments
          .filter((c) => statuses.get(c.id)?.kind === "attached")
          .map((c) => c.id)
          .join(",")}
      </span>
      <span data-testid="probe-anchor-2">{state.comments[1]?.anchor_text ?? ""}</span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/report.html",
            fileName: "report.html",
            text: REBUILT,
            body: REBUILT,
            comments: COMMENTS,
            readOnly: false,
            format: "html",
          })
        }
      />
    </div>
  );
}

async function loadRebuilt() {
  render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <Harness />
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("probe-load"));
  await waitFor(() => expect(screen.getByTestId("fm-lost-banner")).toBeTruthy());
}

describe("recovering a review after a regeneration", () => {
  it("reports every anchor as lost, and offers to reattach only the sure ones", async () => {
    await loadRebuilt();
    expect(screen.getByTestId("fm-lost-banner").textContent).toContain(
      "3 comments lost their anchors",
    );
    // Comment 3's passage appears twice, so it is not offered — that one
    // is a decision only the reviewer can make.
    expect(screen.getByTestId("fm-lost-banner-reattach-all").textContent).toBe("Reattach 2 of 3");
  });

  it("puts the sure ones back in one action", async () => {
    await loadRebuilt();
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));

    await waitFor(() => expect(screen.getByTestId("probe-attached").textContent).toBe("1,2"));
    const body = screen.getByTestId("probe-body").textContent ?? "";
    expect(body).toContain("<!-- fmc:1 -->variable projection<!-- /fmc:1 -->");
    // The figure was found by the id it kept, even though its caption was
    // renumbered, and the markers wrap the whole block.
    expect(body).toContain('<!-- fmc:2 --><figure id="fig-3">');
    expect(body).toContain("</figure><!-- /fmc:2 -->");
    // Nothing but markers was added.
    expect(body.replace(/<!--\s*\/?fmc:\d+\s*-->/g, "")).toBe(REBUILT);
  });

  it("refreshes the anchor text from what it actually reattached to", async () => {
    await loadRebuilt();
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));
    await waitFor(() => expect(screen.getByTestId("probe-attached").textContent).toBe("1,2"));
    // The caption is "Figure 4" now; the record should say so rather than
    // keep claiming "Figure 3".
    expect(screen.getByTestId("probe-anchor-2").textContent).toContain("Figure 4");
  });

  it("leaves the ambiguous one for the modal", async () => {
    await loadRebuilt();
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));
    await waitFor(() =>
      expect(screen.getByTestId("fm-lost-banner").textContent).toContain(
        "1 comment lost its anchor",
      ),
    );
    // With nothing confident left, the bulk action is gone and the
    // per-comment flow is the only one offered.
    expect(screen.queryByTestId("fm-lost-banner-reattach-all")).toBeNull();
    fireEvent.click(screen.getByTestId("fm-lost-banner-recover"));
    await waitFor(() => expect(screen.getByTestId("fm-reattach-modal")).toBeTruthy());
  });
});
