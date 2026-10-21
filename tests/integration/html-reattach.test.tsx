// Recovering a review after the report was regenerated.
//
// The agent reruns, writes a whole new file, and every marker is gone.
// The comments survive in the trailing block, so the app has to put them
// back — and doing that one modal at a time turns a mechanical recovery
// into a dozen identical decisions.

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { classifyAnchors } from "../../src/format";
import type { Comment } from "../../src/format/types";

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

function Harness({ comments = COMMENTS }: { comments?: Comment[] }) {
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
      <span data-testid="probe-contexts">
        {JSON.stringify(state.comments.map((c) => [c.context_before, c.context_after]))}
      </span>
      <button
        data-testid="probe-load"
        onClick={() =>
          dispatch({
            type: "load",
            filePath: "/tmp/report.html",
            fileName: "report.html",
            text: REBUILT,
            body: REBUILT,
            comments,
            readOnly: false,
            format: "html",
          })
        }
      />
    </div>
  );
}

async function loadRebuilt(comments?: Comment[]) {
  render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <Harness comments={comments} />
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

  it("reattaches a repeated passage when its recorded surroundings pick one copy", async () => {
    const withContext = COMMENTS.map((c) =>
      c.id === 3
        ? { ...c, context_before: "The outer loop is a grid, then a golden-section polish." }
        : c,
    );
    await loadRebuilt(withContext);
    expect(screen.getByTestId("fm-lost-banner-reattach-all").textContent).toBe("Reattach all 3");
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));
    await waitFor(() => expect(screen.getByTestId("probe-attached").textContent).toBe("1,2,3"));
    const body = screen.getByTestId("probe-body").textContent ?? "";
    expect(body).toContain(
      "polish.</p>\n<p><!-- fmc:3 -->Ambiguous sentence.<!-- /fmc:3 --></p>\n<p>Ambiguous sentence.</p>",
    );
  });

  it("records the surroundings as the reader sees them, not as markup", async () => {
    await loadRebuilt();
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));
    await waitFor(() => expect(screen.getByTestId("probe-attached").textContent).toBe("1,2"));
    const [first] = JSON.parse(screen.getByTestId("probe-contexts").textContent ?? "[]");
    expect(first[0]).toBe("Eliminating the linear block analytically is");
    expect(first.join(" ")).not.toMatch(/[<>]/);
  });

  it("doesn't offer a comment whose element is still there without its text", async () => {
    // Made on a passage inside the figure; the rebuilt figure doesn't
    // have it, though the same words are elsewhere on the page.
    const elsewhere: Comment = {
      id: 4,
      anchor_text: "golden-section polish",
      anchor_scope: "#fig-3",
      context_before: "then a",
      author: "Sam",
      timestamp: "2026-08-16T09:07:00Z",
      resolved: false,
      body: "Which polish?",
    };
    await loadRebuilt([...COMMENTS, elsewhere]);
    expect(screen.getByTestId("fm-lost-banner-reattach-all").textContent).toBe("Reattach 2 of 4");
    fireEvent.click(screen.getByTestId("fm-lost-banner-reattach-all"));
    await waitFor(() => expect(screen.getByTestId("probe-attached").textContent).toBe("1,2"));
    expect(screen.getByTestId("probe-body").textContent).not.toContain("fmc:4");
  });
});
