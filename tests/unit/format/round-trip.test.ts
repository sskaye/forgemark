import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseForgemarkFile, serializeForgemarkFile } from "../../../src/format";

// Phase 3 HARD GATE: every fixture in tests/ai/fixtures/ must round-trip
// byte-equivalent through parse → serialize. Phase 4 cannot start until
// this is green.

const FIXTURE_DIR = resolve(__dirname, "..", "..", "ai", "fixtures");
const fixtureNames = readdirSync(FIXTURE_DIR)
  .filter((n) => n.endsWith(".md"))
  .sort();

describe("round-trip parity (HARD GATE)", () => {
  it("at least seven fixtures exist", () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of fixtureNames) {
    it(`${name} round-trips byte-equivalent`, () => {
      const original = readFileSync(resolve(FIXTURE_DIR, name), "utf-8");
      const parsed = parseForgemarkFile(original);
      const serialized = serializeForgemarkFile(parsed);
      expect(serialized, `${name} parse → serialize must produce the source bytes`).toBe(original);
    });
  }

  for (const name of fixtureNames) {
    it(`${name} parses without error and yields well-formed comments`, () => {
      const original = readFileSync(resolve(FIXTURE_DIR, name), "utf-8");
      const parsed = parseForgemarkFile(original);
      expect(parsed.comments.length).toBeGreaterThan(0);
      for (const c of parsed.comments) {
        expect(typeof c.id).toBe("number");
        expect(typeof c.author).toBe("string");
        expect(typeof c.timestamp).toBe("string");
        expect(typeof c.resolved).toBe("boolean");
      }
    });
  }

  it("a deep parse → serialize → reparse cycle is structurally idempotent", () => {
    for (const name of fixtureNames) {
      const original = readFileSync(resolve(FIXTURE_DIR, name), "utf-8");
      const a = parseForgemarkFile(original);
      const b = parseForgemarkFile(serializeForgemarkFile(a));
      expect(b.comments).toEqual(a.comments);
    }
  });
});
