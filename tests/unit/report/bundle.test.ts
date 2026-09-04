// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { buildBridge, BRIDGE_OUT } from "../../../scripts/build-bridge.mjs";

// The report bridge is a committed build artifact, like the CLI bundle,
// and goes stale the same way.

describe("report bridge bundle", () => {
  it("exists", () => {
    expect(existsSync(BRIDGE_OUT)).toBe(true);
  });

  it("matches a fresh build (run `npm run build:bridge` and commit if not)", async () => {
    const result = await buildBridge({ write: false });
    const fresh = Buffer.from(result.outputFiles![0].contents);
    const committed = readFileSync(BRIDGE_OUT);
    expect(fresh.equals(committed), "src/report/report-bridge.built.js is stale").toBe(true);
  });

  it("is self-contained and safe to splice into a script tag", () => {
    const text = readFileSync(BRIDGE_OUT, "utf8");
    expect(text).not.toMatch(/^\s*import /m);
    expect(text).not.toContain("</script");
  });
});
