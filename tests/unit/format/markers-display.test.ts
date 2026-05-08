import { describe, it, expect } from "vitest";
import { bodyWithAnchorSpans, bodyFromAnchorSpans } from "../../../src/format/markers-display";

describe("bodyWithAnchorSpans / bodyFromAnchorSpans", () => {
  it("converts marker pairs to spans", () => {
    const input = "foo <!-- fmc:1 -->bar<!-- /fmc:1 --> baz";
    expect(bodyWithAnchorSpans(input)).toBe('foo <span data-anchor-id="1">bar</span> baz');
  });

  it("converts multiple paired markers", () => {
    const input = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->";
    expect(bodyWithAnchorSpans(input)).toBe(
      '<span data-anchor-id="1">one</span> and <span data-anchor-id="2">two</span>',
    );
  });

  it("converts spans back to markers", () => {
    const input = 'foo <span data-anchor-id="1">bar</span> baz <span data-anchor-id="2">qux</span>';
    expect(bodyFromAnchorSpans(input)).toBe(
      "foo <!-- fmc:1 -->bar<!-- /fmc:1 --> baz <!-- fmc:2 -->qux<!-- /fmc:2 -->",
    );
  });

  it("round-trips body → spans → body", () => {
    const samples = [
      "<!-- fmc:1 -->bit<!-- /fmc:1 -->",
      "no markers at all",
      "before <!-- fmc:1 -->one<!-- /fmc:1 --> after",
      "<!-- fmc:1 -->a<!-- /fmc:1 --> <!-- fmc:2 -->b<!-- /fmc:2 -->",
    ];
    for (const s of samples) {
      expect(bodyFromAnchorSpans(bodyWithAnchorSpans(s))).toBe(s);
    }
  });

  it("leaves unrelated spans alone", () => {
    const input = '<span class="foo">unrelated</span> rest';
    expect(bodyFromAnchorSpans(input)).toBe(input);
  });
});
