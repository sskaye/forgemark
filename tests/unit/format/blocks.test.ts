import { describe, it, expect } from "vitest";
import { splitBlocks, spliceBlocks } from "../../../src/format/blocks";

const BODY = [
  "# Title",
  "",
  "Para one",
  "wrapped.",
  "",
  "<!-- a comment -->",
  "",
  "<!-- fmc:3 -->",
  "```py",
  "x()",
  "```",
  "<!-- /fmc:3 -->",
  "",
  "* one",
  "* two",
  "",
  "[r]: https://x.y",
  "",
  "> quote",
  "",
  "Last.",
  "",
].join("\n");

describe("splitBlocks", () => {
  it("maps every top-level block to its own lines", () => {
    const { blocks } = splitBlocks(BODY);
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["markdown", "# Title"],
      ["markdown", "Para one\nwrapped."],
      ["verbatim", "<!-- a comment -->"],
      ["markdown", "<!-- fmc:3 -->\n```py\nx()\n```\n<!-- /fmc:3 -->"],
      ["markdown", "* one\n* two"],
      ["markdown", "> quote"],
      ["markdown", "Last."],
    ]);
    // The reference definition lives in a gap, untouched by any block.
    const covered = new Set<number>();
    for (const b of blocks) for (let i = b.start; i < b.end; i++) covered.add(i);
    expect(covered.has(BODY.split("\n").indexOf("[r]: https://x.y"))).toBe(false);
  });

  it("does not let a marker at the start of a line split its paragraph", () => {
    const { blocks } = splitBlocks(
      "Too high over\n<!-- fmc:1 -->the evening<!-- /fmc:1 -->, see it.\n\nNext.\n",
    );
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["markdown", "Too high over\n<!-- fmc:1 -->the evening<!-- /fmc:1 -->, see it."],
      ["markdown", "Next."],
    ]);
  });

  it("keeps a stray marker line and other raw HTML verbatim", () => {
    const { blocks } = splitBlocks("<!-- /fmc:9 -->\n\n<div>\n<b>x</b>\n</div>\n\npara\n");
    expect(blocks.map((b) => b.kind)).toEqual(["verbatim", "verbatim", "markdown"]);
  });

  it("gives a footnote definition its own block", () => {
    const { blocks } = splitBlocks("Claim[^1].\n[^1]: Note\nwrapped.\n[^2]: Two.\n\nAfter.\n");
    expect(blocks.map((b) => b.text)).toEqual([
      "Claim[^1].",
      "[^1]: Note\nwrapped.",
      "[^2]: Two.",
      "After.",
    ]);
  });

  it("does not merge marker lines whose ids disagree", () => {
    const { blocks } = splitBlocks("<!-- fmc:1 -->\n```\nx\n```\n<!-- /fmc:2 -->\n");
    expect(blocks.map((b) => b.kind)).toEqual(["verbatim", "markdown", "verbatim"]);
  });
});

describe("spliceBlocks", () => {
  it("replaces one block and leaves every other byte alone", () => {
    const map = splitBlocks(BODY);
    const out = spliceBlocks(map, 1, 2, "Para one edited\nwrapped.\n");
    expect(out).toBe(BODY.replace("Para one\nwrapped.", "Para one edited\nwrapped."));
  });

  it("replaces a run of blocks with a different number of blocks", () => {
    const map = splitBlocks(BODY);
    const out = spliceBlocks(map, 4, 6, "- one\n- two\n\nMerged.");
    expect(out).toBe(
      BODY.replace("* one\n* two\n\n[r]: https://x.y\n\n> quote", "- one\n- two\n\nMerged."),
    );
  });

  it("removes a block and keeps a single blank line between its neighbours", () => {
    const map = splitBlocks(BODY);
    const out = spliceBlocks(map, 2, 3, "");
    expect(out).toBe(BODY.replace("<!-- a comment -->\n\n", ""));
  });

  it("inserts before a block and after the last one", () => {
    const map = splitBlocks(BODY);
    expect(spliceBlocks(map, 1, 1, "New.")).toBe(BODY.replace("Para one", "New.\n\nPara one"));
    expect(spliceBlocks(map, map.blocks.length, map.blocks.length, "Appended.")).toBe(
      BODY.replace("Last.\n", "Last.\n\nAppended.\n"),
    );
  });

  it("works on an empty body", () => {
    const map = splitBlocks("");
    expect(spliceBlocks(map, 0, 0, "First.")).toBe("First.");
  });
});
