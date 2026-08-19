// Source ↔ rendered-text offset mapping.
//
// Everything HTML review does — creating an anchor from a selection,
// reattaching an orphan, describing an element anchor — reduces to
// mapping a position in the text a reader sees onto a byte of the
// source. If this map is wrong, markers land inside entities or tags and
// the file is corrupted, so it is tested against the real generated
// report rather than only against toys.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildHtmlTextMap,
  rangeIsExact,
  textRangeToSource,
} from "../../../src/format/html/textmap";

const report = readFileSync(resolve(__dirname, "..", "..", "fixtures", "report.html"), "utf-8");

// Map a phrase found in the rendered text back to source and return the
// raw slice, which is what a marker splice would wrap.
function sliceForPhrase(html: string, phrase: string) {
  const map = buildHtmlTextMap(html);
  const at = map.text.indexOf(phrase);
  expect(at).toBeGreaterThanOrEqual(0);
  const span = textRangeToSource(map, at, at + phrase.length, { requireExact: true });
  expect(span).not.toBeNull();
  return html.slice(span!.start, span!.end);
}

describe("buildHtmlTextMap", () => {
  it("extracts rendered text and drops tags", () => {
    const map = buildHtmlTextMap("<p>Hello <b>bold</b> world</p>");
    expect(map.text).toBe("Hello bold world");
  });

  it("excludes script, style, title and textarea content", () => {
    const html =
      "<title>T</title><style>p{color:red}</style><script>var x=1</script>" +
      "<p>visible</p><textarea>hidden</textarea>";
    expect(buildHtmlTextMap(html).text).toBe("visible");
  });

  it("decodes entities and maps every produced character onto the entity span", () => {
    const html = "<p>a &amp; b</p>";
    const map = buildHtmlTextMap(html);
    expect(map.text).toBe("a & b");
    // The `&` is one rendered character spanning five source bytes.
    const amp = map.text.indexOf("&");
    expect(html.slice(map.starts[amp], map.ends[amp])).toBe("&amp;");
  });

  it("handles the entities the report actually uses", () => {
    const html = "<p>7.6&nbsp;&minus;&nbsp;1 &times; 2 &amp; more</p>";
    const map = buildHtmlTextMap(html);
    expect(map.text).toBe("7.6 − 1 × 2 & more");
    expect(map.runs.every((r) => r.exact)).toBe(true);
  });

  it("normalises CRLF the way the HTML parser does", () => {
    const map = buildHtmlTextMap("<p>a\r\nb</p>");
    expect(map.text).toBe("a\nb");
    expect(map.runs.every((r) => r.exact)).toBe(true);
  });

  it("round-trips a phrase through source offsets", () => {
    expect(sliceForPhrase("<p>Across <b>fourteen</b> interviews</p>", "fourteen")).toBe("fourteen");
  });

  it("maps a phrase that contains an entity back to its raw source form", () => {
    expect(sliceForPhrase("<p>Golub &amp; Pereyra</p>", "Golub & Pereyra")).toBe(
      "Golub &amp; Pereyra",
    );
  });
});

describe("buildHtmlTextMap on the generated report", () => {
  const map = buildHtmlTextMap(report);

  it("maps every text run exactly", () => {
    const inexact = map.runs.filter((r) => !r.exact);
    expect(inexact).toEqual([]);
  });

  it("recovers the report's prose, not its markup", () => {
    expect(map.text).toContain("variable projection");
    expect(map.text).toContain("The defaults reproduce the old simulator exactly");
    // CSS custom properties live in <style> and must not be reachable.
    expect(map.text).not.toContain("--band-severe-low");
    expect(map.text).not.toContain("<p>");
  });

  it("maps arbitrary prose positions back to bytes that slice cleanly", () => {
    for (const phrase of [
      "variable projection",
      "profile likelihood",
      "18 families in the library",
      "Protein sensitivity is hard to pin",
    ]) {
      expect(sliceForPhrase(report, phrase)).toBe(phrase);
    }
  });

  it("keeps positions monotonic across the whole document", () => {
    for (let i = 1; i < map.starts.length; i++) {
      expect(map.starts[i]).toBeGreaterThanOrEqual(map.starts[i - 1]);
    }
  });

  it("reports exactness for ranges", () => {
    const at = map.text.indexOf("variable projection");
    expect(rangeIsExact(map, at, at + 19)).toBe(true);
  });

  it("refuses out-of-range and inverted ranges", () => {
    expect(textRangeToSource(map, -1, 5)).toBeNull();
    expect(textRangeToSource(map, 5, 5)).toBeNull();
    expect(textRangeToSource(map, 0, map.text.length + 1)).toBeNull();
  });
});
