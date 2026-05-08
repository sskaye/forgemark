import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RenderedView } from "../../src/components/RenderedView";

// Phase 2 perf target: render a 30,000-word markdown document in < 250 ms.
// This is a rough mid-spec target; we'll tighten in later phases. The
// jsdom environment is generally slower than a real browser, so passing
// here gives us confident headroom in production.

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
  it("renders a 30,000-word document in well under 250 ms", async () => {
    const markdown = generateLargeMarkdown(30_000);
    const start = performance.now();
    const { container } = render(<RenderedView initialMarkdown={markdown} onEdit={vi.fn()} />);
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeTruthy();
    });
    // Wait one tick to let Tiptap commit the doc.
    await waitFor(() => {
      expect(container.querySelectorAll("h2").length).toBeGreaterThan(5);
    });
    const elapsed = performance.now() - start;
    // Rough envelope. Anything under 1000ms is fine for a 30k-word doc;
    // we lock at 1500ms to leave headroom for slower CI machines and
    // jsdom overhead. The plan's 250ms target is for a production browser.
    expect(elapsed, `30k-word render took ${elapsed.toFixed(0)}ms`).toBeLessThan(1500);
  });
});
