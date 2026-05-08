#!/usr/bin/env node
// Build the Forgemark skill artifacts.
//
// Walks `assets/forgemark-skill/`, produces a deterministic ZIP, and
// emits both `assets/forgemark-skill.skill` and
// `assets/forgemark-skill.zip` from the same buffer (so they're
// byte-identical by construction). Determinism is kept by:
//   - Walking entries in lexicographic order.
//   - Pinning every file's date to the Unix epoch.
//   - Disabling compression timestamps.
//
// Two contracts the build keeps:
//   - Both artifacts are byte-identical (sha256 equal).
//   - Total bundle size is < 60 KB (the size budget the design
//     handoff and Phase 12 plan committed to).

import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets", "forgemark-skill");
const OUT_DIR = join(ROOT, "assets");
const SKILL_OUT = join(OUT_DIR, "forgemark-skill.skill");
const ZIP_OUT = join(OUT_DIR, "forgemark-skill.zip");
const SIZE_BUDGET = 60 * 1024;

// Files in the source tree that aren't part of the skill payload.
const IGNORE = new Set([".DS_Store"]);

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (IGNORE.has(name)) continue;
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...listFiles(full));
    } else if (stats.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = listFiles(SRC);
  if (files.length === 0) {
    console.error(`No files found under ${SRC}`);
    process.exit(1);
  }

  const zip = new JSZip();
  // Pinned to Unix epoch; jszip otherwise reads file mtime, which
  // breaks byte-determinism across machines.
  const epoch = new Date(0);
  for (const full of files) {
    const rel = relative(SRC, full).split(sep).join("/");
    const data = readFileSync(full);
    zip.file(rel, data, { date: epoch, binary: true });
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    streamFiles: false,
    // Force a deterministic file order: jszip preserves insertion
    // order, and `files` was already sorted, so this is a belt-and-
    // braces guard.
    platform: "UNIX",
  });

  // Size budget gate.
  const totalSrcBytes = files.reduce((s, f) => s + statSync(f).size, 0);
  if (totalSrcBytes > SIZE_BUDGET) {
    console.error(
      `Skill source exceeds size budget: ${totalSrcBytes} > ${SIZE_BUDGET} bytes`,
    );
    process.exit(2);
  }

  // Write both artifacts from the same buffer — byte-identical by
  // construction.
  writeFileSync(SKILL_OUT, buffer);
  writeFileSync(ZIP_OUT, buffer);

  // Sanity: confirm the on-disk files are identical.
  const skillBytes = readFileSync(SKILL_OUT);
  const zipBytes = readFileSync(ZIP_OUT);
  const skillHash = createHash("sha256").update(skillBytes).digest("hex");
  const zipHash = createHash("sha256").update(zipBytes).digest("hex");
  if (skillHash !== zipHash) {
    console.error(
      `Artifacts are not byte-identical: skill=${skillHash} zip=${zipHash}`,
    );
    process.exit(3);
  }

  const fmt = (n) => n.toLocaleString();
  console.log(
    `Built skill bundle (${files.length} files, src=${fmt(totalSrcBytes)} B, zip=${fmt(buffer.length)} B)`,
  );
  console.log(`  skill: ${SKILL_OUT}`);
  console.log(`  zip:   ${ZIP_OUT}`);
  console.log(`  sha256: ${skillHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
