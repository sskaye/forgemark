import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const ROOT = resolve(__dirname, "..", "..");
const SKILL_PATH = join(ROOT, "assets", "forgemark-skill.skill");
const ZIP_PATH = join(ROOT, "assets", "forgemark-skill.zip");
const SRC = join(ROOT, "assets", "forgemark-skill");
const SIZE_BUDGET = 60 * 1024;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function totalSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) total += totalSize(full);
    else total += s.size;
  }
  return total;
}

describe("skill bundle — source", () => {
  it("ships the canonical files at the bundle root", () => {
    for (const file of ["SKILL.md", "AGENTS.md", "README.md"]) {
      expect(existsSync(join(SRC, file))).toBe(true);
    }
  });

  it("has at least three example files", () => {
    const examples = readdirSync(join(SRC, "examples")).filter((n) => n.endsWith(".md"));
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it("source tree is under the 60 KB budget", () => {
    expect(totalSize(SRC)).toBeLessThan(SIZE_BUDGET);
  });
});

describe("skill bundle — built artifacts", () => {
  it("both .skill and .zip exist (run `npm run build:skill` if missing)", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
    expect(existsSync(ZIP_PATH)).toBe(true);
  });

  it("are byte-identical (sha256 match)", () => {
    const a = readFileSync(SKILL_PATH);
    const b = readFileSync(ZIP_PATH);
    expect(a.length).toBe(b.length);
    expect(sha256(a)).toBe(sha256(b));
  });

  it(".skill extracts to a directory containing SKILL.md, AGENTS.md, README.md, examples/", async () => {
    const buf = readFileSync(SKILL_PATH);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).sort();
    expect(names).toContain("SKILL.md");
    expect(names).toContain("AGENTS.md");
    expect(names).toContain("README.md");
    expect(names.some((n) => n.startsWith("examples/") && n.endsWith(".md"))).toBe(true);
  });

  it("SKILL.md inside the bundle matches the source SKILL.md", async () => {
    const buf = readFileSync(SKILL_PATH);
    const zip = await JSZip.loadAsync(buf);
    const inZip = await zip.file("SKILL.md")!.async("string");
    const src = readFileSync(join(SRC, "SKILL.md"), "utf8");
    expect(inZip).toBe(src);
  });
});
