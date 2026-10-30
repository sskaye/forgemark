#!/usr/bin/env node
// Delete every published release but the latest, so the Releases page
// lists only the version to download.
//
//   npm run release:prune           # lists what it would delete
//   npm run release:prune -- --yes  # deletes them
//
// Run it once whatever downloads a pinned version from a release has
// moved to the latest: ForgeGraph fetches `forgemark-cli-<ver>.mjs` from
// its version's release, and a deleted release can't come back. The git
// tags stay, so every version can still be checked out and rebuilt.
// Installed apps are unaffected: they read the latest release's
// latest.json. Drafts are left alone.

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const yes = process.argv.includes("--yes");

function gh(...args) {
  return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" });
}

const latest = JSON.parse(gh("api", "repos/{owner}/{repo}/releases/latest"));
const older = JSON.parse(gh("api", "--paginate", "--slurp", "repos/{owner}/{repo}/releases"))
  .flat()
  .filter((r) => !r.draft && r.id !== latest.id);

console.log(`Latest: ${latest.tag_name} (kept).`);
if (older.length === 0) {
  console.log("No other published release.");
  process.exit(0);
}
if (!yes) {
  console.log(`Would delete ${older.length} release(s), keeping their tags:`);
  for (const r of older) console.log(`    ${r.tag_name}`);
  console.log("Run again with --yes to delete them.");
  process.exit(0);
}
for (const r of older) {
  gh("api", "-X", "DELETE", `repos/{owner}/{repo}/releases/${r.id}`);
  console.log(`✓ Deleted the ${r.tag_name} release (the tag stays).`);
}
