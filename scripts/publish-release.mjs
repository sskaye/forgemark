#!/usr/bin/env node
// Publish the draft release for a version, once everything is on it.
//
//   npm run release:publish            # the version in package.json
//   npm run release:publish -- 1.10.0
//
// Releases are immutable once published (a repository setting): no asset
// can be added, replaced, or removed afterwards. So the macOS .dmg and
// the CI-built Windows, Linux, and CLI assets all go onto a draft, and
// this script publishes it only when the pushed tag exists and every
// asset the release should carry is there. It also checks that the CLI
// asset is the bundle committed at the tag, byte for byte.
//
// Nothing is published if any check fails; the draft stays as it is.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION =
  process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const TAG = `v${VERSION}`;
const CLI_ASSET = `forgemark-cli-${VERSION}.mjs`;
const CLI_PATH = "assets/forgemark-skill/scripts/forgemark.mjs";

// Every asset a release carries, and the workflow (or step) that puts it
// there, for the message when one is missing.
const EXPECTED = {
  [`Forgemark_${VERSION}_universal.dmg`]: "npm run release, then the draft's create step",
  [`Forgemark_${VERSION}_x64_en-US.msi`]: "windows-release.yml",
  [`Forgemark_${VERSION}_x64-setup.exe`]: "windows-release.yml",
  [`Forgemark_${VERSION}_amd64.deb`]: "linux-release.yml (x86_64)",
  [`Forgemark_${VERSION}_amd64.AppImage`]: "linux-release.yml (x86_64)",
  ["SHA256SUMS-linux-x86_64.txt"]: "linux-release.yml (x86_64)",
  [`Forgemark_${VERSION}_arm64.deb`]: "linux-release.yml (arm64)",
  [`Forgemark_${VERSION}_aarch64.AppImage`]: "linux-release.yml (arm64)",
  ["SHA256SUMS-linux-arm64.txt"]: "linux-release.yml (arm64)",
  [CLI_ASSET]: "cli-release.yml",
  ["SHA256SUMS-cli.txt"]: "cli-release.yml",
  ["forgemark-cli-LICENSE.txt"]: "cli-release.yml",
};

function gh(...args) {
  return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" });
}

function fail(message) {
  console.error(`\n✗ ${message}\n  Nothing was published.`);
  process.exit(1);
}

// The draft. The tag endpoint doesn't see drafts, so look through the list.
const releases = JSON.parse(gh("api", "--paginate", "--slurp", "repos/{owner}/{repo}/releases"))
  .flat()
  .filter((r) => r.tag_name === TAG);
if (releases.length === 0) fail(`No release for ${TAG}. See RELEASING.md, "Tag and publish".`);
if (releases.length > 1)
  fail(`${releases.length} releases share the tag ${TAG}; delete the extras.`);
const [release] = releases;
if (!release.draft) fail(`${TAG} is already published: ${release.html_url}`);

// The tag must already be on the remote. Publishing a draft whose tag
// doesn't exist makes GitHub create one at the tip of the target branch,
// which may not be the commit the assets were built from.
let tagSha;
try {
  const ref = JSON.parse(gh("api", `repos/{owner}/{repo}/git/ref/tags/${TAG}`));
  tagSha = ref.object.sha;
} catch {
  fail(`The tag ${TAG} isn't on GitHub yet. Push it: git push origin ${TAG}`);
}

// Every asset, nothing half-uploaded.
const assets = new Map(release.assets.map((a) => [a.name, a]));
const missing = Object.keys(EXPECTED).filter((name) => assets.get(name)?.state !== "uploaded");
if (missing.length > 0) {
  fail(
    `${TAG} is missing ${missing.length} asset(s):\n` +
      missing.map((name) => `    ${name}  ← ${EXPECTED[name]}`).join("\n"),
  );
}
const extra = [...assets.keys()].filter((name) => !(name in EXPECTED));
if (extra.length > 0) {
  console.warn(`! ${TAG} also carries assets this script doesn't expect: ${extra.join(", ")}`);
}

// The CLI asset is the bundle committed at the tag. GitHub reports each
// asset's SHA-256 as `digest`; compare it with the file in git.
let committed;
try {
  committed = execFileSync("git", ["show", `${TAG}:${CLI_PATH}`], { cwd: ROOT, stdio: "pipe" });
} catch {
  fail(`No ${CLI_PATH} at ${TAG} here. Fetch the tag: git fetch origin --tags`);
}
const want = `sha256:${createHash("sha256").update(committed).digest("hex")}`;
const got = assets.get(CLI_ASSET).digest;
if (got && got !== want) {
  fail(`${CLI_ASSET} on the draft (${got}) is not ${CLI_PATH} at ${TAG} (${want}).`);
}
if (!got) console.warn(`! GitHub reported no digest for ${CLI_ASSET}; its bytes were not checked.`);

console.log(
  `✓ ${TAG} (${tagSha.slice(0, 7)}): all ${Object.keys(EXPECTED).length} assets present.`,
);
gh("release", "edit", TAG, "--draft=false");
console.log(`✓ Published: https://github.com/sskaye/forgemark/releases/tag/${TAG}`);
