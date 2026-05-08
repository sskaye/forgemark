import { describe, it, expect } from "vitest";
import { replaceAnchoredText, stripAnchoredMarkers } from "../../../src/format/compose";

describe("replaceAnchoredText", () => {
  it("replaces the anchored text and strips markers", () => {
    const body = "before <!-- fmc:1 -->old wording<!-- /fmc:1 --> after";
    const result = replaceAnchoredText(body, 1, "new wording");
    expect(result).not.toBeNull();
    expect(result?.body).toBe("before new wording after");
    expect(result?.previousText).toBe("old wording");
  });

  it("returns null when no marker pair exists", () => {
    const body = "no markers anywhere";
    expect(replaceAnchoredText(body, 1, "x")).toBeNull();
  });

  it("returns the previous text even if the replacement equals it", () => {
    const body = "x <!-- fmc:1 -->same<!-- /fmc:1 --> y";
    const r = replaceAnchoredText(body, 1, "same");
    expect(r?.previousText).toBe("same");
    expect(r?.body).toBe("x same y");
  });
});

describe("stripAnchoredMarkers", () => {
  it("removes markers but keeps the anchored text", () => {
    const body = "before <!-- fmc:1 -->word<!-- /fmc:1 --> after";
    const result = stripAnchoredMarkers(body, 1);
    expect(result).toBe("before word after");
  });
  it("returns null when no marker pair exists", () => {
    expect(stripAnchoredMarkers("plain prose", 1)).toBeNull();
  });
  it("only touches the targeted id", () => {
    const body = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->";
    expect(stripAnchoredMarkers(body, 2)).toBe("<!-- fmc:1 -->one<!-- /fmc:1 --> and two");
  });
});
