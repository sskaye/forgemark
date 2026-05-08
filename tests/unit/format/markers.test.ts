import { describe, it, expect } from "vitest";
import { findMarkers, pairMarkers } from "../../../src/format/markers";

describe("findMarkers", () => {
  it("finds a single open + close pair", () => {
    const body = "alpha <!-- fmc:1 -->bravo<!-- /fmc:1 --> charlie";
    const markers = findMarkers(body);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ type: "open", id: 1 });
    expect(markers[1]).toMatchObject({ type: "close", id: 1 });
  });

  it("finds multiple comments in order", () => {
    const body = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->";
    const markers = findMarkers(body);
    expect(markers.map((m) => `${m.type}:${m.id}`)).toEqual([
      "open:1",
      "close:1",
      "open:2",
      "close:2",
    ]);
  });

  it("ignores markers inside fenced code blocks", () => {
    const body = [
      "Before fence.",
      "",
      "```",
      "<!-- fmc:1 -->literal<!-- /fmc:1 -->",
      "```",
      "",
      "After fence.",
    ].join("\n");
    expect(findMarkers(body)).toEqual([]);
  });

  it("ignores markers inside tilde-fenced code blocks", () => {
    const body = ["~~~", "<!-- fmc:5 -->x<!-- /fmc:5 -->", "~~~"].join("\n");
    expect(findMarkers(body)).toEqual([]);
  });

  it("ignores markers inside inline code spans", () => {
    const body = "Use `<!-- fmc:7 -->` to anchor.";
    expect(findMarkers(body)).toEqual([]);
  });

  it("ignores markers inside indented code blocks", () => {
    const body = ["regular paragraph", "", "    <!-- fmc:9 -->x<!-- /fmc:9 -->"].join("\n");
    expect(findMarkers(body)).toEqual([]);
  });

  it("finds markers around inline code", () => {
    const body = "before <!-- fmc:1 -->`code`<!-- /fmc:1 --> after";
    const markers = findMarkers(body);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe("open");
    expect(markers[1].type).toBe("close");
  });

  it("tolerates whitespace inside markers", () => {
    const body = "<!--   fmc:3   -->x<!--  /fmc:3  -->";
    const markers = findMarkers(body);
    expect(markers).toHaveLength(2);
    expect(markers[0].id).toBe(3);
    expect(markers[1].id).toBe(3);
  });
});

describe("pairMarkers", () => {
  it("pairs each open with the next close of the same id", () => {
    const body = "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->";
    const { pairs, unmatched } = pairMarkers(findMarkers(body));
    expect(unmatched).toEqual([]);
    expect(pairs.map((p) => p.id)).toEqual([1, 2]);
  });

  it("flags unmatched opens", () => {
    const body = "<!-- fmc:1 -->only open here";
    const { pairs, unmatched } = pairMarkers(findMarkers(body));
    expect(pairs).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].type).toBe("open");
  });

  it("flags unmatched closes", () => {
    const body = "only close: <!-- /fmc:1 -->";
    const { pairs, unmatched } = pairMarkers(findMarkers(body));
    expect(pairs).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].type).toBe("close");
  });
});
