#!/usr/bin/env node
// Start a release: create its draft, then tag the commit and push the tag.
//
//   npm run release:start
//
// Run it on main, up to date with GitHub, once the version bump (with its
// CHANGELOG section and rebuilt skill) has merged. The draft comes first
// because a draft holds no tag: the release workflows that the tag starts
// (macOS, Windows, Linux, the CLI) each add their files to it and never
// create one. The draft's notes are the version's CHANGELOG section.
// When the workflows have finished, `npm run release:publish` publishes.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection } from "./latest-json.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const TAG = `v${VERSION}`;

function sh(cmd, ...args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\n✗ ${message}\n  Nothing was created.`);
  process.exit(1);
}

sh("git", "fetch", "--quiet", "origin", "main", "--tags");
if (sh("git", "status", "--porcelain")) fail("The working tree has changes. Commit or stash them.");
const head = sh("git", "rev-parse", "HEAD");
if (head !== sh("git", "rev-parse", "origin/main")) {
  fail("HEAD isn't origin/main. Release from main, up to date: git checkout main && git pull");
}
if (sh("git", "tag", "--list", TAG)) fail(`The tag ${TAG} already exists.`);
const releases = JSON.parse(
  sh("gh", "api", "--paginate", "--slurp", "repos/{owner}/{repo}/releases"),
)
  .flat()
  .filter((r) => r.tag_name === TAG);
if (releases.length > 0) fail(`A release for ${TAG} already exists: ${releases[0].html_url}`);

const notes = changelogSection(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), VERSION);
if (!notes) fail(`CHANGELOG.md has no "## [${VERSION}]" section.`);
sh("npm", "run", "--silent", "version:check");

const file = join(mkdtempSync(join(tmpdir(), "forgemark-notes-")), "notes.md");
writeFileSync(file, notes + "\n");
sh("gh", "release", "create", TAG, "--draft", "--title", `Forgemark ${TAG}`, "--notes-file", file);
console.log(`✓ Created the draft for ${TAG}.`);

sh("git", "tag", TAG, head);
sh("git", "push", "--quiet", "origin", TAG);
console.log(`✓ Tagged ${head.slice(0, 7)} as ${TAG} and pushed it.`);
console.log(
  `\nThe macOS, Windows, Linux and CLI release workflows are running:\n` +
    `    gh run list --branch ${TAG}\n` +
    `When they've finished: npm run release:publish`,
);
