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
// It also writes the release's `latest.json`, the manifest the in-app
// updater reads (`scripts/latest-json.mjs`), from the update files'
// signatures on the draft, and attaches it before publishing: once
// published, it couldn't be added. The `.sig` files then come off the
// draft: the manifest carries each signature, and the updater never
// fetches them, so a release lists only the files someone downloads.
//
// Nothing is published if any check fails; the draft stays as it is.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLatestJson, changelogSection, updateAssets } from "./latest-json.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION =
  process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const TAG = `v${VERSION}`;
const CLI_ASSET = `forgemark-cli-${VERSION}.mjs`;
const CLI_PATH = "assets/forgemark-skill/scripts/forgemark.mjs";

// Every asset a published release carries, and the workflow (or step)
// that puts it there, for the message when one is missing: one install
// file per platform, the macOS update, the CLI, and the manifest.
const EXPECTED = {
  [`Forgemark_${VERSION}_universal.dmg`]: "npm run release, then the draft's create step",
  [`Forgemark_${VERSION}_universal.app.tar.gz`]: "npm run release, then the draft's create step",
  [`Forgemark_${VERSION}_x64-setup.exe`]: "windows-release.yml",
  [`Forgemark_${VERSION}_amd64.AppImage`]: "linux-release.yml (x86_64)",
  [`Forgemark_${VERSION}_aarch64.AppImage`]: "linux-release.yml (arm64)",
  [CLI_ASSET]: "cli-release.yml",
  ["latest.json"]: "this script, from the update files' signatures",
};

// The update files' signatures, on the draft only until latest.json is
// written from them.
const SIGNED_BY = {
  [`Forgemark_${VERSION}_universal.app.tar.gz`]: "npm run release, then the draft's create step",
  [`Forgemark_${VERSION}_x64-setup.exe`]: "windows-release.yml",
  [`Forgemark_${VERSION}_amd64.AppImage`]: "linux-release.yml (x86_64)",
  [`Forgemark_${VERSION}_aarch64.AppImage`]: "linux-release.yml (arm64)",
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
if (releases.length === 0) fail(`No release for ${TAG}. See docs/releasing.md, "Tag and publish".`);
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

let assets = new Map(release.assets.map((a) => [a.name, a]));
const uploaded = (name) => assets.get(name)?.state === "uploaded";

// The updater's manifest, from the signatures, once they are all here.
if (!uploaded("latest.json")) {
  const sigs = Object.keys(updateAssets(VERSION)).map((file) => `${file}.sig`);
  const absent = sigs.filter((name) => !uploaded(name));
  if (absent.length > 0) {
    fail(
      `${TAG} is missing ${absent.length} signature(s) to write latest.json from:\n` +
        absent
          .map((name) => `    ${name}  ← ${SIGNED_BY[name.replace(/\.sig$/, "")] ?? "?"}`)
          .join("\n"),
    );
  } else {
    const signatures = {};
    for (const sig of sigs) {
      signatures[sig.replace(/\.sig$/, "")] = gh(
        "api",
        `repos/{owner}/{repo}/releases/assets/${assets.get(sig).id}`,
        "-H",
        "Accept: application/octet-stream",
      );
    }
    let changelog = "";
    try {
      changelog = execFileSync("git", ["show", `${TAG}:CHANGELOG.md`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Fetch the tag for the notes; the manifest works without them.
    }
    const manifest = buildLatestJson({
      version: VERSION,
      notes: changelogSection(changelog, VERSION),
      pubDate: new Date().toISOString(),
      signatures,
    });
    const dir = mkdtempSync(join(tmpdir(), "forgemark-latest-"));
    const file = join(dir, "latest.json");
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    gh("release", "upload", TAG, file);
    console.log(
      `✓ Attached latest.json for ${Object.keys(manifest.platforms).length} platform keys.`,
    );
    const fresh = JSON.parse(gh("api", `repos/{owner}/{repo}/releases/${release.id}`));
    assets = new Map(fresh.assets.map((a) => [a.name, a]));
  }
}

// Every asset, nothing half-uploaded.
const missing = Object.keys(EXPECTED).filter((name) => !uploaded(name));
if (missing.length > 0) {
  fail(
    `${TAG} is missing ${missing.length} asset(s):\n` +
      missing.map((name) => `    ${name}  ← ${EXPECTED[name]}`).join("\n"),
  );
}
// Nothing else but the signatures, which come off below.
const isSig = (name) => name.endsWith(".sig") && name.replace(/\.sig$/, "") in SIGNED_BY;
const extra = [...assets.keys()].filter((name) => !(name in EXPECTED) && !isSig(name));
if (extra.length > 0) {
  fail(
    `${TAG} carries asset(s) a release shouldn't: ${extra.join(", ")}. ` +
      `Delete them from the draft (gh release delete-asset ${TAG} <name>) and rerun.`,
  );
}

// The manifest is this version's, and every file it points to is on the
// release: an updater sent to a missing file fails with no way back.
const manifest = JSON.parse(
  gh(
    "api",
    `repos/{owner}/{repo}/releases/assets/${assets.get("latest.json").id}`,
    "-H",
    "Accept: application/octet-stream",
  ),
);
if (manifest.version !== VERSION) {
  fail(
    `latest.json is for ${manifest.version}, not ${VERSION}. Delete it from the draft and rerun.`,
  );
}
for (const [key, entry] of Object.entries(manifest.platforms)) {
  const name = decodeURIComponent(entry.url.split("/").pop());
  if (!entry.url.includes(`/download/${TAG}/`) || !uploaded(name)) {
    fail(`latest.json sends ${key} to ${entry.url}, which isn't on ${TAG}.`);
  }
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

// The signatures are in latest.json now; take them off.
for (const [name, asset] of assets) {
  if (!isSig(name)) continue;
  gh("api", "-X", "DELETE", `repos/{owner}/{repo}/releases/assets/${asset.id}`);
}

console.log(
  `✓ ${TAG} (${tagSha.slice(0, 7)}): all ${Object.keys(EXPECTED).length} assets present, and nothing else.`,
);
gh("release", "edit", TAG, "--draft=false");
console.log(`✓ Published: https://github.com/sskaye/forgemark/releases/tag/${TAG}`);
