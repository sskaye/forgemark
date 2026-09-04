import { describe, it, expect } from "vitest";
import { compareFingerprints, fingerprint } from "../../src/services/conflict";

describe("conflict detection — mtime fast path", () => {
  it("mtime equal → unchanged, regardless of hash", () => {
    const prev = { mtimeMs: 1000, hash: "hashA" };
    const next = { mtimeMs: 1000, hash: "hashB" };
    expect(compareFingerprints(prev, next)).toBe("unchanged");
  });

  it("mtime null on either side falls through to hash", () => {
    expect(compareFingerprints({ mtimeMs: null, hash: "h1" }, { mtimeMs: 1000, hash: "h1" })).toBe(
      "unchanged",
    );
    expect(compareFingerprints({ mtimeMs: null, hash: "h1" }, { mtimeMs: 1000, hash: "h2" })).toBe(
      "changed",
    );
  });
});

describe("conflict detection — hash check", () => {
  it("mtime differs but hash equal → unchanged (touch-save)", () => {
    const prev = { mtimeMs: 1000, hash: "hashA" };
    const next = { mtimeMs: 2000, hash: "hashA" };
    expect(compareFingerprints(prev, next)).toBe("unchanged");
  });

  it("mtime differs and hash differs → changed", () => {
    const prev = { mtimeMs: 1000, hash: "hashA" };
    const next = { mtimeMs: 2000, hash: "hashB" };
    expect(compareFingerprints(prev, next)).toBe("changed");
  });
});

describe("fingerprint() produces stable hashes", () => {
  it("same text → same hash regardless of mtime", async () => {
    const a = await fingerprint("hello", 1);
    const b = await fingerprint("hello", 999);
    expect(a.hash).toEqual(b.hash);
  });

  it("different text → different hash", async () => {
    const a = await fingerprint("hello", 1);
    const b = await fingerprint("hello!", 1);
    expect(a.hash).not.toEqual(b.hash);
  });
});
