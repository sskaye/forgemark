import { describe, it, expect } from "vitest";
import { parseForgemarkFile, serializeForgemarkFile } from "../../../src/format";
import { locateAnchor, AnchorError } from "../../../src/format/locate";
import { findFrontmatterPassage, locateInFrontmatter } from "../../../src/format/frontmatterAnchor";
import { addComment, listComments, CommandError } from "../../../cli/lib";
import { reattachOrphans } from "../../../src/format/reattachAll";
import { lintText } from "../../../cli/lint";

// A Markdown file's front matter is YAML other programs read, so a
// comment on it carries no markers (which would change the YAML); it is a
// floating note marked `anchor_frontmatter`, shown on its passage.
// Requested by ForgeGraph, whose agent skill's description lives there.

const F =
  '---\nname: example\ndescription: "What this file is for."\n---\n\n# Heading\n\nBody text.\n';
const NOW = "2026-10-21T00:00:00Z";
const add = (body: string, anchor: string, extra = {}) =>
  addComment({ body, comments: [] }, "markdown", {
    author: "R",
    anchor,
    body: "b",
    now: NOW,
    ...extra,
  });

describe("comments on the front matter", () => {
  it("leave the YAML as it was and record the passage", () => {
    const { file, summary } = add(F, "What this file is for.");
    expect(file.body).toBe(F);
    expect(summary).toMatch(/on the front matter/);
    expect(file.comments[0]).toMatchObject({
      floating: true,
      anchor_frontmatter: true,
      anchor_text: "What this file is for.",
    });
    expect(listComments(file, "markdown")[0]).toMatchObject({
      status: "frontmatter",
      current: "What this file is for.",
    });
  });

  it("round-trip through the file and lint clean", () => {
    const { file } = add(F, "What this file is for.");
    const text = serializeForgemarkFile(file);
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].anchor_frontmatter).toBe(true);
    expect(lintText(text, "markdown").problems).toEqual([]);
  });

  it("are never placed by markers, and a body copy of the text is preferred", () => {
    expect(() => locateAnchor(F, "What this file is for.", "markdown")).toThrow(AnchorError);
    const both = F.replace("Body text.", "Body text: example.");
    const { file } = add(both, "example");
    expect(file.body).toContain("<!-- fmc:1 -->example<!-- /fmc:1 -->.");
    expect(file.comments[0].anchor_frontmatter).toBeUndefined();
  });

  it("refuse a suggestion, which would edit the YAML", () => {
    expect(() => add(F, "What this file is for.", { suggest: "x" })).toThrow(CommandError);
  });

  it("are left alone by reattach --all", () => {
    const { file } = add(F, "What this file is for.");
    expect(reattachOrphans(file, "markdown").outcomes).toEqual([]);
  });

  it("warn when the passage leaves the front matter, and find it when it moves", () => {
    const { file } = add(F, "What this file is for.");
    const moved = F.replace("name: example\n", "name: example\nversion: 2\n");
    expect(findFrontmatterPassage(moved, file.comments[0])).not.toBeNull();
    const gone = serializeForgemarkFile({
      body: F.replace("What this file is for.", "Something else."),
      comments: file.comments,
    });
    expect(lintText(gone, "markdown").problems[0].message).toMatch(/no longer there/);
  });

  it("flags markers an older version put inside the front matter", () => {
    const old =
      '---\nname: example\ndescription: "<!-- fmc:1 -->What this file is for.<!-- /fmc:1 -->"\n---\n\nBody.\n' +
      "<!-- forgemark-comments\n- id: 1\n  anchor_text: What this file is for.\n  author: R\n" +
      "  timestamp: 2026-10-21T00:00:00Z\n  resolved: false\n  body: |\n    x\n-->\n";
    expect(lintText(old, "markdown").problems[0].message).toMatch(/inside the front matter/);
  });

  it("asks for an occurrence when the passage repeats in the front matter", () => {
    const twice = "---\na: same\nb: same\n---\n\nBody.\n";
    expect(() => locateInFrontmatter(twice, "same")).toThrow(/appears 2 times/);
    expect(locateInFrontmatter(twice, "same", { occurrence: 2 }).context_before).toMatch(/b:$/);
  });
});
