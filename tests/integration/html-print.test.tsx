// Printing a report.
//
// Printing renders the document into a hidden article and then prints the
// whole webview. The review-notes appendix is the same for both document
// kinds; only the body differs, and it has to — a report printed through
// the Markdown editor would come out as its own source code.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { PrintDocument } from "../../src/components/PrintDocument";
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

const REPORT = `<!doctype html>
<html><head><title>Meals</title>
<style>figure{border:1px solid #ccc}</style></head>
<body>
<p>Minimising is <b><!-- fmc:1 -->variable projection<!-- /fmc:1 --></b>.</p>
<figure><figcaption>Figure 1. Control holds</figcaption><svg viewBox="0 0 10 10"></svg></figure>
</body></html>
`;

const COMMENTS: Comment[] = [
  {
    id: 1,
    anchor_text: "variable projection",
    author: "Claude",
    timestamp: "2026-08-16T09:00:00Z",
    resolved: false,
    body: "Worth a gloss.",
  },
];

const OPTIONS = { includeComments: true, includeSuggestions: true };

function printFrame(container: HTMLElement): Document {
  const frame = container.querySelector<HTMLIFrameElement>("[data-testid='fm-print-html']");
  if (!frame?.contentDocument) throw new Error("print frame not ready");
  return frame.contentDocument;
}

describe("printing an HTML report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints the report itself, carrying its own styling", async () => {
    const { container } = render(
      <ThemeProvider initialPreference="light">
        <PrintDocument
          body={REPORT}
          comments={COMMENTS}
          fileName="report.html"
          options={OPTIONS}
          format="html"
        />
      </ThemeProvider>,
    );
    await waitFor(() => expect(printFrame(container).querySelector("figure")).not.toBeNull());
    const doc = printFrame(container);
    // The report's own CSS and charts reach the paper, not an
    // approximation of them.
    expect(doc.querySelector("style")?.textContent).toContain("figure{border");
    expect(doc.querySelector("svg")).not.toBeNull();
    expect(doc.body.textContent).toContain("variable projection");
  });

  it("keeps the review notes appendix", async () => {
    render(
      <ThemeProvider initialPreference="light">
        <PrintDocument
          body={REPORT}
          comments={COMMENTS}
          fileName="report.html"
          options={OPTIONS}
          format="html"
        />
      </ThemeProvider>,
    );
    const review = await screen.findByTestId("fm-print-review");
    expect(review).toHaveTextContent("Worth a gloss.");
    expect(review).toHaveTextContent("variable projection");
  });

  it("does not route a Markdown document through the report frame", async () => {
    const { container } = render(
      <ThemeProvider initialPreference="light">
        <PrintDocument body={"Some prose.\n"} comments={[]} fileName="notes.md" options={OPTIONS} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fm-print-document")).toBeTruthy());
    expect(container.querySelector("[data-testid='fm-print-html']")).toBeNull();
  });
});
