import { describe, it, expect } from "vitest";
import { compareFingerprints, fingerprint, fingerprintSync } from "../../src/services/conflict";

describe("conflict detection — mtime fast path", () => {
  it("mtime equal → unchanged, regardless of hash", () => {
    const prev = fingerprintSync("a", 1000, "hashA");
    const next = fingerprintSync("b", 1000, "hashB");
    expect(compareFingerprints(prev, next)).toBe("unchanged");
  });

  it("mtime null on either side falls through to hash", () => {
    expect(
      compareFingerprints(fingerprintSync("a", null, "h1"), fingerprintSync("a", 1000, "h1")),
    ).toBe("unchanged");
    expect(
      compareFingerprints(fingerprintSync("a", null, "h1"), fingerprintSync("a", 1000, "h2")),
    ).toBe("changed");
  });
});

describe("conflict detection — hash check", () => {
  it("mtime differs but hash equal → unchanged (touch-save)", () => {
    const prev = fingerprintSync("same", 1000, "hashA");
    const next = fingerprintSync("same", 2000, "hashA");
    expect(compareFingerprints(prev, next)).toBe("unchanged");
  });

  it("mtime differs and hash differs → changed", () => {
    const prev = fingerprintSync("a", 1000, "hashA");
    const next = fingerprintSync("b", 2000, "hashB");
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
