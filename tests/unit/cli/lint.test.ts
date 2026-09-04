import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { lintText } from "../../../cli/lint";

const FIXTURES = resolve(__dirname, "..", "..", "ai", "fixtures");

const RECORD = (id: number, extra = "") =>
  `- id: ${id}\n  anchor_text: "p${id}"\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: b\n${extra}`;

function doc(body: string, records: string): string {
  return `${body}\n<!-- forgemark-comments\n${records}-->\n`;
}

const errors = (text: string, format: "markdown" | "html" = "markdown") =>
  lintText(text, format).problems.filter((p) => p.severity === "error");
const warnings = (text: string, format: "markdown" | "html" = "markdown") =>
  lintText(text, format).problems.filter((p) => p.severity === "warning");

describe("lintText", () => {
  it("passes every shipped fixture with no errors", () => {
    for (const name of readdirSync(FIXTURES).filter((n) => n.endsWith(".md"))) {
      const report = lintText(readFileSync(resolve(FIXTURES, name), "utf8"), "markdown");
      expect(errors(readFileSync(resolve(FIXTURES, name), "utf8")), name).toEqual([]);
      expect(report.counts.comments).toBeGreaterThan(0);
    }
  });

  it("reports unreadable YAML with the file line and record", () => {
    const text = doc(
      "Prose <!-- fmc:1 -->p1<!-- /fmc:1 -->.\n",
      `- id: 1\n  anchor_text: |\n     wrapped\n    line\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: b\n`,
    );
    const [e] = errors(text);
    expect(e.line).toBe(7);
    expect(e.commentId).toBe(1);
    expect(e.message).toMatch(/Malformed comments YAML/);
  });

  it("reports a duplicate key rather than keeping the last one", () => {
    const text = doc(
      "Prose <!-- fmc:1 -->p1<!-- /fmc:1 -->.\n",
      RECORD(1, "  replies: []\n  replies: []\n"),
    );
    expect(errors(text)[0].message).toMatch(/unique/);
  });

  it("reports a second comments block", () => {
    const first = doc("Prose.\n", `- id: 1\n  body: [broken\n`);
    const text = first + "\n<!-- forgemark-comments\n" + RECORD(1, "  floating: true\n") + "-->\n";
    const es = errors(text);
    expect(es.some((e) => /second comments block/.test(e.message) && e.line === 3)).toBe(true);
  });

  it("reports colliding ids and recordless or unmatched markers", () => {
    expect(errors(doc("<!-- fmc:1 -->a<!-- /fmc:1 -->", RECORD(1) + RECORD(1)))[0].message).toMatch(
      /more than once/,
    );
    expect(
      errors(doc("<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->", RECORD(1)))[0]
        .message,
    ).toMatch(/no YAML record/);
    expect(errors(doc("<!-- fmc:1 -->a", RECORD(1)))[0].message).toMatch(/Unmatched/);
  });

  it("reports overlapping anchors, which the parser tolerates", () => {
    const body = "<!-- fmc:1 -->a <!-- fmc:2 -->b<!-- /fmc:1 --> c<!-- /fmc:2 -->";
    const es = errors(doc(body, RECORD(1) + RECORD(2)));
    expect(es[0].message).toMatch(/anchors of comments 1 and 2 overlap/);
  });

  it("reports a floating note that still has markers", () => {
    const text = doc("<!-- fmc:1 -->a<!-- /fmc:1 -->", RECORD(1, "  floating: true\n"));
    expect(errors(text)[0].message).toMatch(/marked floating but has a marker pair/);
  });

  it("warns about orphans and anchor_text drift, and counts them", () => {
    const text = doc(
      "Prose <!-- fmc:1 -->changed words<!-- /fmc:1 --> and more.\n",
      RECORD(1) + RECORD(2),
    );
    const report = lintText(text, "markdown");
    expect(errors(text)).toEqual([]);
    const ws = warnings(text);
    expect(ws.find((w) => w.commentId === 1)?.message).toMatch(/no longer matches/);
    expect(ws.find((w) => w.commentId === 2)?.message).toMatch(/orphaned/);
    expect(report.counts).toEqual({ comments: 2, attached: 1, orphaned: 1, floating: 0 });
    expect(ws.find((w) => w.commentId === 2)?.line).toBe(10);
  });

  it("accepts anchor_text that matches under the app's normalisation", () => {
    const text = doc("Prose <!-- fmc:1 -->**p1**<!-- /fmc:1 -->.\n", RECORD(1));
    expect(warnings(text)).toEqual([]);
  });

  it("skips the anchor_text check for element anchors", () => {
    const text = doc(
      '<html><body><!-- fmc:1 --><figure id="f"><figcaption>Cap</figcaption><svg/></figure><!-- /fmc:1 --></body></html>',
      RECORD(1, '  anchor_kind: element\n  anchor_selector: "#f"\n'),
    );
    expect(lintText(text, "html").problems).toEqual([]);
  });

  it("accepts the app's fractional-second timestamps", () => {
    const text = doc(
      "<!-- fmc:1 -->p1<!-- /fmc:1 -->",
      `- id: 1\n  anchor_text: p1\n  author: A\n  timestamp: "2026-09-03T21:49:43.117Z"\n  resolved: false\n  body: b\n`,
    );
    expect(warnings(text)).toEqual([]);
  });

  it("warns about a timestamp that is not ISO 8601 UTC", () => {
    const text = doc(
      "<!-- fmc:1 -->p1<!-- /fmc:1 -->",
      `- id: 1\n  anchor_text: p1\n  author: A\n  timestamp: "May 7"\n  resolved: false\n  body: b\n`,
    );
    expect(warnings(text)[0].message).toMatch(/ISO 8601/);
  });
});
