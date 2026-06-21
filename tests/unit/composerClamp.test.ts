// Bug 2: the new-comment composer (position: fixed, anchored below the
// selection) ran off the bottom of the viewport at end-of-document,
// putting Save/Cancel out of reach. clampToViewport computes the nudge
// that brings it back on screen.

import { describe, it, expect } from "vitest";
import { clampToViewport } from "../../src/components/NewCommentComposer";

const VW = 1000;
const VH = 800;

function box(top: number, left: number, width: number, height: number) {
  return { top, left, right: left + width, bottom: top + height };
}

describe("clampToViewport", () => {
  it("leaves a fully on-screen panel untouched", () => {
    expect(clampToViewport(box(100, 100, 360, 240), VW, VH)).toEqual({ dx: 0, dy: 0 });
  });

  it("pulls a panel overflowing the bottom up by exactly the overflow (+margin)", () => {
    // top 700, height 240 -> bottom 940, viewport 800. Should move up so
    // bottom sits at VH - 8 = 792 -> dy = 792 - 940 = -148.
    const { dx, dy } = clampToViewport(box(700, 100, 360, 240), VW, VH);
    expect(dx).toBe(0);
    expect(dy).toBe(-148);
    expect(700 + dy + 240).toBe(VH - 8); // bottom now within viewport
  });

  it("pulls a panel overflowing the right edge left", () => {
    const { dx } = clampToViewport(box(100, 700, 360, 240), VW, VH);
    expect(dx).toBe(VW - 8 - (700 + 360));
    expect(700 + dx + 360).toBe(VW - 8);
  });

  it("never pushes the top off-screen when the panel is taller than the viewport", () => {
    // A panel taller than the viewport: keep the top visible (margin),
    // accepting that the bottom still overflows — header stays reachable.
    const { dy } = clampToViewport(box(200, 100, 360, 900), VW, VH);
    expect(200 + dy).toBe(8);
  });

  it("clamps both axes together (bottom-right corner)", () => {
    const { dx, dy } = clampToViewport(box(720, 760, 360, 240), VW, VH);
    expect(720 + dy + 240).toBe(VH - 8);
    expect(760 + dx + 360).toBe(VW - 8);
  });
});
