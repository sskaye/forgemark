import { describe, it, expect } from "vitest";
import { buildHtmlTextMap } from "../../src/format/html/textmap";

// The text model runs on every locate in a report. A generated catalog
// can be a 20,000-row table written with no whitespace between cells,
// which puts a block break at every cell; a break check that reads the
// end of the growing string makes V8 flatten it each time and the build
// quadratic (2 s here, against 0.14 s). Generous bound, for slow CI.

describe("HTML text model performance", () => {
  it("maps a 1 MB table with touching cells in well under a second", () => {
    const rows = Array.from(
      { length: 20000 },
      (_, i) => `<tr><td>param${i}</td><td>value ${i}</td><td>note.</td></tr>`,
    ).join("");
    const html = `<!doctype html><html><body><table>${rows}</table></body></html>`;
    const t0 = performance.now();
    const map = buildHtmlTextMap(html);
    const elapsed = performance.now() - t0;
    expect(map.text).toContain("param19999\nvalue 19999\nnote.");
    expect(elapsed).toBeLessThan(1000);
  });
});
