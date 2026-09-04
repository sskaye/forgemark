import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { hashSkillTree, parseManifest, type SkillFile } from "../../src/services/skillTree";

const ROOT = resolve(__dirname, "..", "..");
const SKILL_PATH = join(ROOT, "assets", "forgemark-skill.skill");
const ZIP_PATH = join(ROOT, "assets", "forgemark-skill.zip");
const SRC = join(ROOT, "assets", "forgemark-skill");
const SIZE_BUDGET = 512 * 1024;

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
  it("ships the canonical files at the source root", () => {
    for (const file of ["SKILL.md", "AGENTS.md", "README.md", "scripts/forgemark.mjs"]) {
      expect(existsSync(join(SRC, file))).toBe(true);
    }
  });

  it("has at least three example files", () => {
    const examples = readdirSync(join(SRC, "examples")).filter((n) => n.endsWith(".md"));
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it("source tree is under the 512 KB budget", () => {
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

  // The Claude app and claude.ai accept a zip only when the files sit
  // inside one folder named after the skill; Claude Code's `unzip -d
  // ~/.claude/skills` then lands them in the right place too.
  it(".skill holds one forgemark/ folder with SKILL.md, AGENTS.md, README.md, examples/", async () => {
    const buf = readFileSync(SKILL_PATH);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).sort();
    expect(names.every((n) => n === "forgemark/" || n.startsWith("forgemark/"))).toBe(true);
    expect(names).toContain("forgemark/SKILL.md");
    expect(names).toContain("forgemark/AGENTS.md");
    expect(names).toContain("forgemark/README.md");
    expect(names.some((n) => n.startsWith("forgemark/examples/") && n.endsWith(".md"))).toBe(true);
  });

  it("dates its entries in the zip era, not before it", async () => {
    const zip = await JSZip.loadAsync(readFileSync(SKILL_PATH));
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.getFullYear()).toBeGreaterThanOrEqual(1980);
      expect(entry.date.getFullYear()).toBeLessThan(2090);
    }
  });

  it("SKILL.md inside the bundle matches the source SKILL.md", async () => {
    const buf = readFileSync(SKILL_PATH);
    const zip = await JSZip.loadAsync(buf);
    const inZip = await zip.file("forgemark/SKILL.md")!.async("string");
    const src = readFileSync(join(SRC, "SKILL.md"), "utf8");
    expect(inZip).toBe(src);
  });

  // The committed .skill/.zip are build artifacts, so they can silently
  // fall behind the source they're built from — a v1.4.0 release build
  // found exactly that. This compares CONTENTS rather than bytes on
  // purpose: zip metadata isn't stable enough to diff, so a byte
  // comparison would flake, while stale content is the thing that
  // actually reaches users through Settings → download.
  it("every file in the bundle matches the source tree", async () => {
    const zip = await JSZip.loadAsync(readFileSync(SKILL_PATH));

    const sourceFiles: string[] = [];
    const walk = (dir: string, prefix = "") => {
      for (const name of readdirSync(dir).sort()) {
        if (name === ".DS_Store") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
        else sourceFiles.push(`${prefix}${name}`);
      }
    };
    walk(SRC);

    const inBundle = Object.keys(zip.files)
      .filter((n) => !zip.files[n].dir)
      .map((n) => n.replace(/^forgemark\//, ""))
      .sort();
    expect(inBundle).toEqual(sourceFiles);

    for (const rel of sourceFiles) {
      const bundled = Buffer.from(await zip.file(`forgemark/${rel}`)!.async("uint8array"));
      const source = readFileSync(join(SRC, ...rel.split("/")));
      expect(
        bundled.equals(source),
        `${rel} differs from source — run \`npm run build:skill\` and commit`,
      ).toBe(true);
    }
  });
});

describe("skill bundle — manifest", () => {
  const manifest = parseManifest(readFileSync(join(SRC, "forgemark-skill.json"), "utf8"));

  it("carries the app's version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(manifest?.version).toBe(pkg.version);
  });

  it("carries the tree hash the app computes over the same files", async () => {
    const files: SkillFile[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir).sort()) {
        if (name === ".DS_Store") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
        else files.push({ path: `${prefix}${name}`, text: readFileSync(full, "utf8") });
      }
    };
    walk(SRC, "");
    expect(await hashSkillTree(files)).toBe(manifest?.tree);
  });
});

describe("skill bundle — SKILL.md front matter", () => {
  // The Agent Skills spec: a name of 64 characters at most, a
  // description of 1024. The Claude app refuses a longer one on upload.
  it("keeps the name and description within the spec's limits", () => {
    const text = readFileSync(join(SRC, "SKILL.md"), "utf8");
    const front = text.split("---")[1];
    const field = (key: string) => front.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1] ?? "";
    expect(field("name")).toBe("forgemark");
    expect(field("name").length).toBeLessThanOrEqual(64);
    expect(field("description").length).toBeGreaterThan(0);
    expect(field("description").length).toBeLessThanOrEqual(1024);
  });
});
