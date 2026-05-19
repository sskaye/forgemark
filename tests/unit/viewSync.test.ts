import { describe, expect, it } from "vitest";
import {
  buildSourceTextIndex,
  findAnchorPosition,
  makeAnchorFromIndex,
} from "../../src/services/viewSync";

describe("view sync text normalization", () => {
  it("ignores Forgemark marker comments and trailing metadata", () => {
    const source =
      "# Title\n\nAlpha <!-- fmc:1 -->linked prose<!-- /fmc:1 --> omega.\n\n" +
      "<!-- forgemark-comments\n" +
      "- id: 1\n" +
      "  body: Hidden metadata\n" +
      "-->\n";

    const index = buildSourceTextIndex(source);

    expect(index.text).toContain("alpha linked prose omega");
    expect(index.text).not.toContain("fmc");
    expect(index.text).not.toContain("hidden metadata");
  });

  it("finds a source offset for a normalized phrase", () => {
    const source = "Intro\n\nAlpha <!-- fmc:1 -->linked prose<!-- /fmc:1 --> omega.\n";
    const index = buildSourceTextIndex(source);
    const anchor = makeAnchorFromIndex(index, source.indexOf("linked"), 0.4);
    expect(anchor?.phrase).toContain("linked prose");

    const pos = anchor ? findAnchorPosition(index, anchor) : null;
    expect(pos).toBe(source.indexOf("linked"));
  });
});
