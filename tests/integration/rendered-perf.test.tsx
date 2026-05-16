import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RenderedView } from "../../src/components/RenderedView";

// Phase 2 perf target: render a 30,000-word markdown document quickly.
// This runs through React, Tiptap, and jsdom, which is slower and noisier
// than a real browser, so the assertion below is a broad regression guard.

function generateLargeMarkdown(approxWords: number): string {
  const lipsum =
    "the quick brown fox jumps over the lazy dog and then proceeds to do something else entirely beside the riverbank";
  const wordsPerSentence = lipsum.split(/\s+/).length;
  const sentences = Math.ceil(approxWords / wordsPerSentence);
  const paras: string[] = [];
  for (let i = 0; i < sentences / 4; i++) {
    if (i % 25 === 0) paras.push(`## Section ${i / 25 + 1}`);
    paras.push([lipsum, lipsum, lipsum, lipsum].join(". ") + ".");
  }
  return paras.join("\n\n");
}

describe("rendered view performance", () => {
  it("renders a 30,000-word document within the jsdom performance budget", async () => {
    const markdown = generateLargeMarkdown(30_000);
    const start = performance.now();
    const { container } = render(
      <RenderedView
        body={markdown}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeTruthy();
    });
    // Wait one tick to let Tiptap commit the doc.
    await waitFor(() => {
      expect(container.querySelectorAll("h2").length).toBeGreaterThan(5);
    });
    const elapsed = performance.now() - start;
    // Rough envelope. Anything under 1000ms is fine for a 30k-word doc
    // locally, but hosted Windows CI has enough jitter that a narrow budget
    // turns healthy runs red. The production-browser target is lower.
    const budgetMs = process.env.CI ? 2500 : 1500;
    expect(elapsed, `30k-word render took ${elapsed.toFixed(0)}ms`).toBeLessThan(budgetMs);
  });
});
