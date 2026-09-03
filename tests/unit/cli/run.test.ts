import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../cli/run";
import { parseForgemarkFile } from "../../../src/format";

// End to end through the command-line surface, on copies of the shipped
// fixtures in a temp directory: argument parsing, exit codes, output
// shape, and the write-refuse-readback contract.

const FIXTURES = resolve(__dirname, "..", "..", "ai", "fixtures");
const REPORT = resolve(__dirname, "..", "..", "fixtures", "report.html");

let dir: string;
let out: string[];
let err: string[];

function copy(name: string, from = FIXTURES): string {
  const dest = join(dir, name);
  writeFileSync(dest, readFileSync(join(from, name)));
  return dest;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forgemark-cli-"));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  delete process.env.FORGEMARK_AUTHOR;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("forgemark CLI", () => {
  it("prints usage with exit 2 when given nothing, 0 for --help", () => {
    expect(main([])).toBe(2);
    expect(out.join("")).toMatch(/Usage:/);
    expect(main(["--help"])).toBe(0);
  });

  it("rejects unknown commands and options", () => {
    expect(main(["frobnicate"])).toBe(2);
    expect(err.join("\n")).toMatch(/Unknown command/);
    expect(main(["list", "x.md", "--bogus"])).toBe(2);
  });

  it("lists comments in a compact form and as JSON", () => {
    const file = copy("02-with-thread.md");
    expect(main(["list", file])).toBe(0);
    expect(out[0]).toBe("#1  comment  open  attached  Maya  2026-05-07");
    expect(out.join("\n")).toMatch(/2 replies, last by Maya/);

    out.length = 0;
    expect(main(["list", file, "--json"])).toBe(0);
    const json = JSON.parse(out.join(""));
    expect(json.format).toBe("markdown");
    expect(json.comments[0]).toMatchObject({ id: 1, status: "attached", author: "Maya" });
    expect(json.comments[0].current_text).toBe("retained at twice the rate");
  });

  it("filters the listing", () => {
    const file = copy("05-resolved-and-edited.md");
    expect(main(["list", file, "--unresolved"])).toBe(0);
    const unresolved = out.filter((l) => /^#\d/.test(l));
    out.length = 0;
    expect(main(["list", file, "--resolved"])).toBe(0);
    const resolved = out.filter((l) => /^#\d/.test(l));
    expect(unresolved.length + resolved.length).toBe(2);
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("shows a thread", () => {
    const file = copy("02-with-thread.md");
    expect(main(["show", file, "1"])).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/^Comment #1 by Maya at 2026-05-07T09:31:00Z — open, attached/);
    expect(text).toMatch(/Reply by Claude at/);
    expect(text).toMatch(/Reply by Maya at/);
    expect(main(["show", file, "7"])).toBe(1);
    expect(main(["show", file, "abc"])).toBe(2);
  });

  it("adds a comment, requiring an author", () => {
    const file = copy("02-with-thread.md");
    expect(
      main([
        "comment",
        file,
        "--anchor",
        "controlling for company size",
        "--body",
        "Which buckets?",
      ]),
    ).toBe(2);
    expect(err.join("\n")).toMatch(/--author is required/);

    process.env.FORGEMARK_AUTHOR = "Claude";
    expect(
      main([
        "comment",
        file,
        "--anchor",
        "controlling for company size",
        "--body",
        "Which buckets?",
      ]),
    ).toBe(0);
    expect(out.at(-1)).toMatch(/Added comment #2/);
    const parsed = parseForgemarkFile(readFileSync(file, "utf8"));
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[1].author).toBe("Claude");
    expect(parsed.body).toContain("<!-- fmc:2 -->controlling for company size<!-- /fmc:2 -->");
  });

  it("reads the body from a file or stdin", () => {
    const file = copy("01-simple.md");
    const bodyFile = join(dir, "body.txt");
    writeFileSync(bodyFile, "Line one: with a colon.\nLine two.\n");
    expect(main(["reply", file, "1", "--author", "Claude", "--body-file", bodyFile])).toBe(0);
    const parsed = parseForgemarkFile(readFileSync(file, "utf8"));
    expect(parsed.comments[0].replies?.[0].body).toBe("Line one: with a colon.\nLine two.\n");
  });

  it("refuses a comment whose anchor overlaps, with exit 1 and nothing written", () => {
    const file = copy("02-with-thread.md");
    const before = readFileSync(file, "utf8");
    expect(
      main(["comment", file, "--author", "C", "--anchor", "twice the rate", "--body", "x"]),
    ).toBe(1);
    expect(err.join("\n")).toMatch(/Reply to comment 1 instead/);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("refuses to write to a file it cannot read, pointing at lint", () => {
    const file = join(dir, "broken.md");
    writeFileSync(
      file,
      "Prose.\n\n<!-- forgemark-comments\n- id: 1\n  floating: true\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: The report: Purpose\n-->\n",
    );
    expect(main(["comment", file, "--author", "C", "--floating", "--body", "x"])).toBe(1);
    expect(err.join("\n")).toMatch(/line 9 \(comment id 1\)/);
    expect(err.join("\n")).toMatch(/forgemark lint/);
  });

  it("resolves, floats, reattaches and deletes", () => {
    const file = copy("04-orphan-and-floating.md");
    expect(main(["resolve", file, "2"])).toBe(0);
    expect(
      parseForgemarkFile(readFileSync(file, "utf8"), { tolerant: true }).comments[1].resolved,
    ).toBe(true);
    expect(main(["unresolve", file, "2"])).toBe(0);

    expect(main(["float", file, "1"])).toBe(0);
    let parsed = parseForgemarkFile(readFileSync(file, "utf8"));
    expect(parsed.comments[0].floating).toBe(true);

    expect(main(["reattach", file, "1", "--anchor", "different definition of activation"])).toBe(0);
    parsed = parseForgemarkFile(readFileSync(file, "utf8"));
    expect(parsed.comments[0].floating).toBeUndefined();
    expect(parsed.body).toContain(
      "<!-- fmc:1 -->different definition of activation<!-- /fmc:1 -->",
    );

    expect(main(["delete", file, "1"])).toBe(0);
    parsed = parseForgemarkFile(readFileSync(file, "utf8"));
    expect(parsed.comments.map((c) => c.id)).toEqual([2]);
    expect(parsed.body).not.toMatch(/fmc:1\b/);
  });

  it("lints several files, with exit codes that reflect severity", () => {
    const ok = copy("01-simple.md");
    const warn = copy("04-orphan-and-floating.md");
    expect(main(["lint", ok, warn])).toBe(0);
    expect(out.join("\n")).toMatch(/01-simple\.md: OK —/);
    expect(out.join("\n")).toMatch(/04-orphan-and-floating\.md: OK with warnings/);
    expect(main(["lint", warn, "--strict"])).toBe(1);

    const broken = join(dir, "broken.md");
    writeFileSync(
      broken,
      "Prose <!-- fmc:1 -->x<!-- /fmc:1 -->.\n\n<!-- forgemark-comments\n- id: 2\n  anchor_text: x\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: b\n-->\n",
    );
    out.length = 0;
    expect(main(["lint", broken])).toBe(1);
    expect(out.join("\n")).toMatch(
      /error: Marker pair for id 1 present in body but no YAML record/,
    );
    expect(out.join("\n")).toMatch(/broken\.md: FAIL/);

    out.length = 0;
    expect(main(["lint", ok, "--json"])).toBe(0);
    const json = JSON.parse(out.join(""));
    expect(json[0].report.counts.comments).toBe(2);
  });

  it("works on an HTML report: text anchor, element anchor, listing", () => {
    const file = copy("report.html", resolve(REPORT, ".."));
    expect(
      main([
        "comment",
        file,
        "--author",
        "Claude",
        "--anchor",
        "the fasting formulation cannot determine",
        "--body",
        "Cite phase 5.",
      ]),
    ).toBe(0);
    const html = readFileSync(file, "utf8");
    expect(html).toMatch(/<!-- fmc:1 -->the fasting formulation cannot determine<!-- \/fmc:1 -->/);
    expect(html).toMatch(/<\/html>\n\n<!-- forgemark-comments\n/);
    expect(main(["lint", file])).toBe(0);
    out.length = 0;
    expect(main(["list", file, "--json"])).toBe(0);
    expect(JSON.parse(out.join("")).format).toBe("html");
  });

  it("anchors a whole element by selector in an HTML report", () => {
    const file = join(dir, "figs.html");
    writeFileSync(
      file,
      "<!doctype html>\n<html><body>\n<p>Intro.</p>\n" +
        '<figure id="fig-3"><figcaption>Figure 3. Recovery</figcaption><svg></svg></figure>\n' +
        '<table id="tbl-1"><tr><th>Day</th></tr><tr><td>1</td></tr></table>\n' +
        "</body></html>\n",
    );
    expect(
      main([
        "comment",
        file,
        "--author",
        "Claude",
        "--selector",
        "#fig-3",
        "--body",
        "Axis labels.",
      ]),
    ).toBe(0);
    expect(
      main(["comment", file, "--author", "Claude", "--selector", "#tbl-1", "--body", "Units?"]),
    ).toBe(0);
    const html = readFileSync(file, "utf8");
    expect(html).toMatch(/<!-- fmc:1 --><figure id="fig-3">.*<\/figure><!-- \/fmc:1 -->/);
    expect(html).toMatch(/<!-- fmc:2 --><table id="tbl-1">.*<\/table><!-- \/fmc:2 -->/);
    const parsed = parseForgemarkFile(html, { format: "html" });
    expect(parsed.comments[0]).toMatchObject({
      anchor_kind: "element",
      anchor_selector: "#fig-3",
      anchor_text: "Figure 3. Recovery",
    });
    expect(parsed.comments[1]).toMatchObject({
      anchor_selector: "#tbl-1",
      anchor_text: "table: Day",
    });

    // The element is now anchored, so a passage inside it is refused.
    expect(
      main(["comment", file, "--author", "C", "--anchor", "Figure 3. Recovery", "--body", "x"]),
    ).toBe(1);
    expect(err.at(-1)).toMatch(/overlaps the anchor of comment 1/);
    expect(main(["comment", file, "--author", "C", "--selector", "#nope", "--body", "x"])).toBe(1);
    expect(main(["lint", file, "--strict"])).toBe(0);
  });

  it("handles a CRLF file: body untouched, comment attached, still readable", () => {
    const file = join(dir, "crlf.md");
    const crlf = "# Title\r\n\r\nA first line that\r\nwraps onto a second.\r\n";
    writeFileSync(file, crlf);
    expect(
      main(["comment", file, "--author", "C", "--anchor", "line that wraps onto", "--body", "x"]),
    ).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(
      text.startsWith(
        "# Title\r\n\r\nA first <!-- fmc:1 -->line that\r\nwraps onto<!-- /fmc:1 --> a second.\r\n",
      ),
    ).toBe(true);
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments[0].anchor_text).toBe("line that wraps onto");
    expect(main(["lint", file, "--strict"])).toBe(0);
    out.length = 0;
    expect(main(["reply", file, "1", "--author", "C", "--body", "y"])).toBe(0);
    expect(parseForgemarkFile(readFileSync(file, "utf8")).comments[0].replies).toHaveLength(1);
  });

  it("exits 3 when the file does not exist", () => {
    expect(main(["list", join(dir, "missing.md")])).toBe(3);
    expect(main(["lint", join(dir, "missing.md")])).toBe(3);
  });
});
