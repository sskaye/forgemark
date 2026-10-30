#!/usr/bin/env node
// Check that each Tauri JS package and the Rust crate it talks to are on
// the same minor version. Tauri requires it, and a mismatch builds and
// tests fine, then fails at run time or in `tauri build`. Dependabot
// updates npm and Cargo separately, so this is what holds them together:
// update both sides in one pull request.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PAIRS = {
  "@tauri-apps/api": "tauri",
  "@tauri-apps/plugin-dialog": "tauri-plugin-dialog",
  "@tauri-apps/plugin-fs": "tauri-plugin-fs",
  "@tauri-apps/plugin-opener": "tauri-plugin-opener",
  "@tauri-apps/plugin-updater": "tauri-plugin-updater",
};

const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
const cargo = readFileSync(resolve(ROOT, "src-tauri", "Cargo.lock"), "utf8");

function crateVersion(name) {
  const m = cargo.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`));
  return m?.[1];
}

const minor = (v) => v.split(".").slice(0, 2).join(".");
let bad = 0;
for (const [pkg, crate] of Object.entries(PAIRS)) {
  const js = lock.packages[`node_modules/${pkg}`]?.version;
  const rs = crateVersion(crate);
  if (!js || !rs) {
    console.error(`✗ ${pkg} ${js ?? "missing"} / ${crate} ${rs ?? "missing"}`);
    bad++;
  } else if (minor(js) !== minor(rs)) {
    console.error(`✗ ${pkg} ${js} and ${crate} ${rs}: update both to the same minor version.`);
    bad++;
  } else {
    console.log(`✓ ${pkg} ${js} / ${crate} ${rs}`);
  }
}
process.exit(bad ? 1 : 0);
