import { describe, it, expect } from "vitest";
import { bodyWithAnchorElements } from "../../../src/format/markers-display";

const open = (id: number) => `<fm-anchor data-edge="open" data-id="${id}"></fm-anchor>`;
const close = (id: number) => `<fm-anchor data-edge="close" data-id="${id}"></fm-anchor>`;

describe("bodyWithAnchorElements", () => {
  it("converts a marker pair to edge elements", () => {
    const input = "foo <!-- fmc:1 -->bar<!-- /fmc:1 --> baz";
    expect(bodyWithAnchorElements(input)).toBe(`foo ${open(1)}bar${close(1)} baz`);
  });

  it("converts multiple paired markers", () => {
    const input = "<!-- fmc:1 -->one<!-- /fmc:1 --> and <!-- fmc:2 -->two<!-- /fmc:2 -->";
    expect(bodyWithAnchorElements(input)).toBe(
      `${open(1)}one${close(1)} and ${open(2)}two${close(2)}`,
    );
  });

  it("leaves a marker quoted in code alone", () => {
    const input = "Keep `<!-- fmc:1 -->` and\n\n```\n<!-- fmc:2 -->x<!-- /fmc:2 -->\n```\n";
    expect(bodyWithAnchorElements(input)).toBe(input);
  });

  it("leaves a body without markers alone", () => {
    expect(bodyWithAnchorElements("no markers at all")).toBe("no markers at all");
  });
});
