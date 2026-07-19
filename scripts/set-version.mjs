#!/usr/bin/env node
// Set the release version everywhere it's recorded.
//
// The version lives in four files that must agree. Doing it by hand is
// how you end up with a tauri.conf.json that disagrees with Cargo.toml
// and a bundle whose name doesn't match its Info.plist — and Cargo.lock
// is the one people forget, because nothing complains until cargo
// silently rewrites it partway through a release build.
//
// Usage:
//   npm run version:set 1.5.0     # set it
//   npm run version:check         # assert all four agree (CI runs this)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each entry: how to read the version out, and how to write a new one in.
// Deliberately regex-on-text rather than parse-and-reserialize — these are
// hand-maintained files and reformatting them would bury the real change.
const FILES = [
  {
    path: "package.json",
    read: (s) => s.match(/"version":\s*"([^"]+)"/)?.[1],
    write: (s, v) => s.replace(/("version":\s*)"[^"]+"/, `$1"${v}"`),
  },
  {
    path: "src-tauri/tauri.conf.json",
    read: (s) => s.match(/"version":\s*"([^"]+)"/)?.[1],
    write: (s, v) => s.replace(/("version":\s*)"[^"]+"/, `$1"${v}"`),
  },
  {
    // The [package] version, not a dependency pin — anchored to line start
    // and taken only once, since dependency tables also contain `version =`.
    path: "src-tauri/Cargo.toml",
    read: (s) => s.match(/^version = "([^"]+)"$/m)?.[1],
    write: (s, v) => s.replace(/^version = "[^"]+"$/m, `version = "${v}"`),
  },
  {
    // Only the forgemark package entry; the file lists every dependency.
    path: "src-tauri/Cargo.lock",
    read: (s) => s.match(/name = "forgemark"\nversion = "([^"]+)"/)?.[1],
    write: (s, v) => s.replace(/(name = "forgemark"\nversion = )"[^"]+"/, `$1"${v}"`),
  },
];

function read(file) {
  const text = readFileSync(join(ROOT, file.path), "utf8");
  const version = file.read(text);
  if (!version) {
    console.error(`✗ could not find a version in ${file.path}`);
    process.exit(1);
  }
  return { text, version };
}

function check() {
  const found = FILES.map((f) => ({ path: f.path, version: read(f).version }));
  const versions = [...new Set(found.map((f) => f.version))];
  for (const f of found) console.log(`  ${f.version.padEnd(12)} ${f.path}`);
  if (versions.length !== 1) {
    console.error(`\n✗ versions disagree: ${versions.join(", ")}`);
    console.error(`  fix with: npm run version:set <version>`);
    process.exit(1);
  }
  console.log(`\n✓ all four agree on ${versions[0]}`);
  return versions[0];
}

const arg = process.argv[2];

if (!arg || arg === "--check") {
  check();
  process.exit(0);
}

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg)) {
  console.error(`✗ "${arg}" is not a semver version (expected e.g. 1.5.0)`);
  process.exit(1);
}

const before = read(FILES[0]).version;
for (const file of FILES) {
  const { text } = read(file);
  const next = file.write(text, arg);
  if (next === text) {
    console.error(`✗ ${file.path} was not modified — the pattern didn't match`);
    process.exit(1);
  }
  writeFileSync(join(ROOT, file.path), next);
}

console.log(`Set ${before} → ${arg}:\n`);
check();
console.log(`\nNext: update CHANGELOG.md, then follow RELEASING.md.`);
