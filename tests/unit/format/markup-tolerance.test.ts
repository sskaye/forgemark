import { describe, it, expect } from "vitest";
import { locateAnchor, applyPlacement } from "../../../src/format/locate";
import { reattachOrphans } from "../../../src/format/reattachAll";
import type { Comment } from "../../../src/format/types";

// A passage is quoted as a reader sees it. Inline markup between a word
// and its punctuation, or link syntax around link text, used to stop it
// matching: "use default." missed "use `default`.", though "bold words
// here." found "**bold words** here.". Reported by ForgeGraph.

const DOC = [
  "If unclear, use `default`. Then go on.",
  "",
  "Also **bold words** here, and **bold words**. Done.",
  "",
  "Use `a` and `b`, or a (**bold**) aside.",
  "",
  "See [the docs](https://example.com) first, then ![the logo](logo.png).",
  "",
].join("\n");

const found = (phrase: string) => {
  const p = locateAnchor(DOC, phrase, "markdown");
  return {
    source: DOC.slice(p.start, p.end),
    anchor: p.anchor_text,
    body: applyPlacement(DOC, p, 1),
  };
};

describe("quoting a passage that carries inline markup", () => {
  it("matches across inline code before punctuation, as ForgeGraph reported", () => {
    expect(found("If unclear, use default.").source).toBe("If unclear, use `default`.");
    // Quoting the backticks still works.
    expect(found("If unclear, use `default`.").anchor).toBe("If unclear, use default.");
  });

  it("matches emphasis, code and parentheses next to punctuation", () => {
    expect(found("bold words.").source).toBe("**bold words**.");
    expect(found("bold words here").source).toContain("bold words** here");
    expect(found("Use a and b, or a (bold) aside.").source).toBe(
      "Use `a` and `b`, or a (**bold**) aside.",
    );
  });

  it("matches link and image text without the link syntax", () => {
    expect(found("See the docs first").source).toBe("See [the docs](https://example.com) first");
    expect(found("then the logo.").anchor).toBe("then the logo.");
  });

  it("keeps the markers outside the markup they cross", () => {
    expect(found("bold words.").body).toContain("<!-- fmc:1 -->**bold words**.<!-- /fmc:1 -->");
  });

  it("finds such a passage again after its markers are lost", () => {
    const c: Comment = {
      id: 1,
      author: "R",
      timestamp: "2026-10-21T00:00:00Z",
      resolved: false,
      body: "x\n",
      anchor_text: "If unclear, use default.",
      context_after: "Then go on.",
    };
    expect(reattachOrphans({ body: DOC, comments: [c] }, "markdown").outcomes[0]).toMatchObject({
      outcome: "attached",
    });
  });
});
