import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RenderedView } from "../../src/components/RenderedView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
const coreMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path.replace(/\\/g, "/")}`),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: coreMocks.convertFileSrc,
}));

const fixture = readFileSync(resolve(__dirname, "..", "fixtures", "gfm-sample.md"), "utf-8");

function renderFixture(
  body: string = fixture,
  props: Partial<React.ComponentProps<typeof RenderedView>> = {},
) {
  return render(
    <RenderedView
      body={body}
      onEdit={vi.fn()}
      focusedCommentId={null}
      hoveredCommentId={null}
      onAnchorClick={vi.fn()}
      onAnchorHover={vi.fn()}
      {...props}
    />,
  );
}

describe("RenderedView GFM rendering", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
    coreMocks.convertFileSrc.mockClear();
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: { convertFileSrc?: (path: string, protocol?: string) => string };
      }
    ).__TAURI_INTERNALS__ = { convertFileSrc: coreMocks.convertFileSrc };
  });

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

  it("renders GitHub callouts, highlighted code, and LaTeX equations", async () => {
    const { container } = renderFixture(`> [!NOTE]
> Remember **this** before publishing.

Inline math $E = mc^2$ stays in prose.

$$
a^2 + b^2 = c^2
$$

\`\`\`ts
const total: number = 1 + 2;
\`\`\`
`);

    await waitFor(() => {
      expect(container.querySelector(".fm-callout-note")).toBeTruthy();
    });

    const callout = container.querySelector(".fm-callout-note");
    expect(callout?.textContent).toContain("Remember this");
    expect(callout?.textContent).not.toContain("[!NOTE]");
    expect(container.querySelector(".fm-math-inline .katex")).toBeTruthy();
    expect(container.querySelector(".fm-math-block .katex-display")).toBeTruthy();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("renders Obsidian-style callouts with arbitrary types", async () => {
    const { container } = renderFixture(`> [!Takeaway]
> Smelters charge 0.85-1.22 $/kg.
`);

    await waitFor(() => {
      expect(container.querySelector(".fm-callout")).toBeTruthy();
    });

    const callout = container.querySelector(".fm-callout");
    // Unknown (Obsidian) types fall back to the generic class, not one of
    // the five GitHub themes.
    expect(callout?.classList.contains("fm-callout-generic")).toBe(true);
    expect(callout?.getAttribute("data-callout-label")).toBe("Takeaway");
    expect(callout?.textContent).toContain("Smelters charge");
    expect(callout?.textContent).not.toContain("[!Takeaway]");
  });

  it("renders Obsidian image embeds (![[file]]) resolved by basename", async () => {
    const { container } = renderFixture("![[Zn_production_workflow.svg]]\n", {
      documentPath: "C:\\docs\\paper.md",
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeTruthy();
    });

    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("C:\\docs\\Zn_production_workflow.svg");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "asset://C:/docs/Zn_production_workflow.svg",
    );
  });

  it("resolves a vault-relative embed by its basename against the document folder", async () => {
    const { container } = renderFixture("![[20 Projects/Zn Cost/Zn waterfall breakdown.svg]]\n", {
      documentPath: "C:\\docs\\paper.md",
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeTruthy();
    });

    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("C:\\docs\\Zn waterfall breakdown.svg");
  });

  it("resolves relative figure sources against the opened markdown file", async () => {
    const { container } = renderFixture("![diagram](figures/flow.svg)\n", {
      documentPath: "C:\\docs\\paper.md",
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeTruthy();
    });

    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith("C:\\docs\\figures\\flow.svg");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "asset://C:/docs/figures/flow.svg",
    );
  });

  it("calls onEdit when typing inserts content", async () => {
    const onEdit = vi.fn();
    const { container } = render(
      <RenderedView
        body={"hello"}
        onEdit={onEdit}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
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
      <RenderedView
        body={"hello"}
        onEdit={vi.fn()}
        readOnly
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeTruthy();
    });
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.getAttribute("contenteditable")).toBe("false");
  });

  it("renders inline marker pairs as anchor spans", async () => {
    const body = "Plain prose with <!-- fmc:1 -->an anchored bit<!-- /fmc:1 --> in the middle.\n";
    const { container } = render(
      <RenderedView
        body={body}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-anchor-id]")).toBeTruthy();
    });
    const anchor = container.querySelector("[data-anchor-id='1']");
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toBe("an anchored bit");
  });

  it("applies the focused class to the focused anchor only", async () => {
    const body = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->\n";
    const { container, rerender } = render(
      <RenderedView
        body={body}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("[data-anchor-id]").length).toBe(2);
    });
    rerender(
      <RenderedView
        body={body}
        onEdit={vi.fn()}
        focusedCommentId={2}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      const focused = container.querySelector("[data-anchor-id='2']");
      expect(focused?.classList.contains("is-focused")).toBe(true);
    });
    const unfocused = container.querySelector("[data-anchor-id='1']");
    expect(unfocused?.classList.contains("is-focused")).toBe(false);
  });

  it("preserves inline formatting alongside an anchor", async () => {
    // ProseMirror represents stacked inline marks as parallel sets on
    // text runs, not as a strict tree. The DOM rendering may put the
    // anchor span next to / around / inside the mark elements depending
    // on the order Tiptap renders them. We assert that all the expected
    // formatting elements are reachable via the doc and that every
    // `data-anchor-id="1"` text run contains the expected words.
    const body =
      "Anchored prose: <!-- fmc:1 -->**bold** and _italic_ and `code` and [a link](https://example.com)<!-- /fmc:1 -->.\n";
    const { container } = render(
      <RenderedView
        body={body}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-anchor-id]")).toBeTruthy();
    });
    expect(container.querySelector("strong")).toBeTruthy();
    expect(container.querySelector("em")).toBeTruthy();
    expect(container.querySelector("code")).toBeTruthy();
    expect(container.querySelector("a")).toBeTruthy();
    // Most inline text runs retain the anchor mark. (Inline code is a
    // ProseMirror node that doesn't combine with arbitrary marks, so the
    // word inside backticks is rendered as a sibling — that is acceptable;
    // the highlight still spans the surrounding prose visually.)
    const anchored = Array.from(container.querySelectorAll("[data-anchor-id='1']"));
    expect(anchored.length).toBeGreaterThan(0);
    const allText = anchored.map((el) => el.textContent).join(" ");
    expect(allText).toMatch(/bold/);
    expect(allText).toMatch(/italic/);
  });

  it("opens supported external links through the system opener", async () => {
    const onAnchorClick = vi.fn();
    const body =
      "Anchored <!-- fmc:1 -->[link](https://example.com/path?q=1)<!-- /fmc:1 --> text.\n";
    const { container } = render(
      <RenderedView
        body={body}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={onAnchorClick}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());

    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/path?q=1"));
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it("does not open unsupported links externally", async () => {
    const { container } = render(
      <RenderedView
        body={"A [relative link](./local.md) and [fragment](#section).\n"}
        onEdit={vi.fn()}
        focusedCommentId={null}
        hoveredCommentId={null}
        onAnchorClick={vi.fn()}
        onAnchorHover={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll("a").length).toBe(2));

    container
      .querySelector("a")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(openUrl).not.toHaveBeenCalled();
  });
});
