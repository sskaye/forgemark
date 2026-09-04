// @vitest-environment node
// esbuild's API checks `TextEncoder` against the real Uint8Array, which
// jsdom's copy fails; this test has no DOM in it anyway.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildCli, CLI_OUT } from "../../../scripts/build-cli.mjs";

// The CLI bundle is a committed build artifact, like the skill zip, and
// can go stale the same way. Rebuilding it here and comparing bytes
// turns "the shipped tool is older than the code" into a failing test.

const ROOT = resolve(__dirname, "..", "..", "..");

describe("CLI bundle", () => {
  it("exists inside the skill source tree", () => {
    expect(existsSync(CLI_OUT)).toBe(true);
    expect(CLI_OUT.startsWith(join(ROOT, "assets", "forgemark-skill"))).toBe(true);
  });

  it("matches a fresh build (run `npm run build:cli` and commit if not)", async () => {
    const result = await buildCli({ write: false });
    const fresh = Buffer.from(result.outputFiles![0].contents);
    const committed = readFileSync(CLI_OUT);
    expect(fresh.equals(committed), "assets/forgemark-skill/scripts/forgemark.mjs is stale").toBe(
      true,
    );
  });

  it("runs under plain node and reports the package version", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const printed = execFileSync(process.execPath, [CLI_OUT, "--version"], { encoding: "utf8" });
    expect(printed.trim()).toBe(version);
  });
});
