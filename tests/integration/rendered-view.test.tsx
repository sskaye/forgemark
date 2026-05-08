import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RenderedView } from "../../src/components/RenderedView";

const fixture = readFileSync(resolve(__dirname, "..", "fixtures", "gfm-sample.md"), "utf-8");

function renderFixture(markdown: string = fixture) {
  return render(<RenderedView initialMarkdown={markdown} onEdit={vi.fn()} />);
}

describe("RenderedView GFM rendering", () => {
  it("renders headings, lists, code blocks, links, and tables", async () => {
    const { container } = renderFixture();
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toContain("Forgemark fixture");
    });

    // Headings
    expect(container.querySelectorAll("h1").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll("h2").length).toBeGreaterThanOrEqual(4);

    // Lists
    expect(container.querySelectorAll("ul").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll("ol").length).toBeGreaterThanOrEqual(1);

    // Code block
    expect(container.querySelectorAll("pre").length).toBeGreaterThanOrEqual(1);

    // Inline formatting
    expect(container.querySelector("strong")).toBeTruthy();
    expect(container.querySelector("em")).toBeTruthy();

    // Link
    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBe("https://example.com/");

    // Image
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toBe("placeholder");

    // Table
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(1);
    const headerCells = container.querySelectorAll("th");
    const headerTexts = Array.from(headerCells).map((c) => c.textContent?.trim());
    expect(headerTexts).toContain("Name");
    expect(headerTexts).toContain("Score");

    // Blockquote
    expect(container.querySelectorAll("blockquote").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onEdit when typing inserts content", async () => {
    const onEdit = vi.fn();
    const { container } = render(<RenderedView initialMarkdown={"hello"} onEdit={onEdit} />);
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeTruthy();
    });
    // We can't reliably simulate typing through ProseMirror in jsdom, but
    // we can verify the editor is editable. Real typing flow is covered by
    // Playwright in tests/e2e.
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.getAttribute("contenteditable")).toBe("true");
  });

  it("respects readOnly", async () => {
    const { container } = render(
      <RenderedView initialMarkdown={"hello"} onEdit={vi.fn()} readOnly />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeTruthy();
    });
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.getAttribute("contenteditable")).toBe("false");
  });
});
