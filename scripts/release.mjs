#!/usr/bin/env node
// Release-build pipeline for the macOS universal binary.
//
// Captures the full sequence so the next release isn't a rediscovery:
//   1. Pre-flight (lint / typecheck / Tauri versions / audit / test / build:skill)
//   2. Universal Tauri build (Intel + Apple Silicon in one .app)
//   3. Notarize the .dmg (Tauri only notarizes the inner .app)
//   4. Staple the .dmg ticket
//   5. Verify codesign + Gatekeeper + staple on both .app and .dmg
//   6. Pack the stapled .app as the in-app update and sign it with the
//      updater key (`Forgemark_<ver>_universal.app.tar.gz` + `.sig`)
//
// The updater key is separate from Apple's: the app checks every update
// against the public half in tauri.conf.json. Its private half is read
// from TAURI_SIGNING_PRIVATE_KEY (a path or the key itself), else
// ~/.tauri/forgemark-updater.key; its password from
// TAURI_SIGNING_PRIVATE_KEY_PASSWORD, else the Keychain item
// "forgemark-updater-key-password" (docs/releasing.md, one-time setup).
//
// Usage:
//
//   # one-time: stash credentials in Keychain (preferred — no plaintext)
//   xcrun notarytool store-credentials forgemark-notary \
//     --apple-id "you@example.com" --team-id "XXXXXXXXXX" \
//     --password "abcd-efgh-ijkl-mnop"
//
//   # then:
//   APPLE_KEYCHAIN_PROFILE=forgemark-notary \
//   APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)" \
//     npm run release
//
//   # alternative: pass credentials inline (less secure)
//   APPLE_ID=… APPLE_PASSWORD=… APPLE_TEAM_ID=… APPLE_SIGNING_IDENTITY=… \
//     npm run release
//
// The script writes nothing outside src-tauri/target. After it
// finishes, the artifacts are ready to attach to a GitHub Release.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;

const APP = join(
  ROOT,
  "src-tauri/target/universal-apple-darwin/release/bundle/macos/Forgemark.app",
);
const DMG = join(
  ROOT,
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg",
  `Forgemark_${VERSION}_universal.dmg`,
);

const MACOS_BUNDLE_DIR = dirname(APP);
const UPDATE = join(MACOS_BUNDLE_DIR, `Forgemark_${VERSION}_universal.app.tar.gz`);

// `display` is what gets logged when the command carries a secret.
function run(cmd, opts = {}) {
  const { display, ...execOpts } = opts;
  console.log(`\n$ ${display ?? cmd}`);
  execSync(cmd, { stdio: "inherit", ...execOpts });
}

function step(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function bail(msg, code = 1) {
  console.error(`\nrelease: ${msg}`);
  process.exit(code);
}

if (process.platform !== "darwin") {
  bail("macOS only — this script signs and notarizes via Apple toolchain.", 2);
}
if (!process.env.APPLE_SIGNING_IDENTITY) {
  bail(
    "APPLE_SIGNING_IDENTITY is required. Set it to the exact common name of\n" +
      'your Developer ID Application cert, e.g. "Developer ID Application: Your\n' +
      'Name (XXXXXXXXXX)". Run `security find-identity -v -p codesigning` to\n' +
      "list the certs in your Keychain.",
    3,
  );
}

// The updater key, found before the long build so a missing one fails
// now rather than after notarization. Never printed.
const updaterKey =
  process.env.TAURI_SIGNING_PRIVATE_KEY ?? join(homedir(), ".tauri", "forgemark-updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(updaterKey)) {
  bail(`No updater signing key at ${updaterKey}. See docs/releasing.md, "Updater signing key".`, 5);
}
let updaterPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
if (updaterPassword === undefined) {
  try {
    updaterPassword = execFileSync(
      "security",
      ["find-generic-password", "-a", "forgemark", "-s", "forgemark-updater-key-password", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).replace(/\n$/, "");
  } catch {
    bail(
      "No password for the updater key: set TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or store it in the\n" +
        'Keychain as "forgemark-updater-key-password" (docs/releasing.md, "Updater signing key").',
      5,
    );
  }
}

step("Pre-flight checks");
run("npm run lint");
run("npm run typecheck");
run("npm run check:tauri");
// No known high or critical vulnerability in what the app ships.
run("npm audit --omit=dev --audit-level=high");
run("npm test");
run("npm run build:skill");

step(`Universal Tauri build for v${VERSION}`);
run("rustup target add x86_64-apple-darwin"); // idempotent
run("npm run tauri -- build --target universal-apple-darwin");

if (!existsSync(DMG)) {
  bail(`Expected DMG at ${DMG} after build, not found.`);
}
if (!existsSync(APP)) {
  bail(`Expected .app at ${APP} after build, not found.`);
}

step("Notarizing DMG");
const profile = process.env.APPLE_KEYCHAIN_PROFILE;
if (profile) {
  run(`xcrun notarytool submit "${DMG}" --keychain-profile "${profile}" --wait`);
} else {
  for (const v of ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!process.env[v]) {
      bail(
        `${v} is missing.\nEither set APPLE_KEYCHAIN_PROFILE (preferred — see\n` +
          "the comment at the top of this file for the one-time `notarytool\n" +
          "store-credentials` invocation) or set APPLE_ID + APPLE_PASSWORD\n" +
          "(an app-specific password from appleid.apple.com) + APPLE_TEAM_ID.",
        4,
      );
    }
  }
  const submit = (password) =>
    `xcrun notarytool submit "${DMG}" ` +
    `--apple-id "${process.env.APPLE_ID}" ` +
    `--password "${password}" ` +
    `--team-id "${process.env.APPLE_TEAM_ID}" ` +
    `--wait`;
  run(submit(process.env.APPLE_PASSWORD), { display: submit("••••••••") });
}

step("Stapling app and DMG");
// Staple both artifacts. The .app must be stapled explicitly: when
// notarizing via APPLE_KEYCHAIN_PROFILE, Tauri's own notarize/staple step
// is skipped, and stapling the DMG does not staple the .app inside it.
// Without this, the `stapler validate "${APP}"` verification below fails.
run(`xcrun stapler staple "${APP}"`);
run(`xcrun stapler staple "${DMG}"`);

step("Verifying signatures, staples, and Gatekeeper assessment");
run(`codesign -dv --verbose=4 "${APP}" 2>&1 | grep -E "Authority|flags"`, {
  shell: "/bin/bash",
});
run(`spctl --assess --verbose=4 "${APP}"`);
run(`xcrun stapler validate "${APP}"`);
run(`xcrun stapler validate "${DMG}"`);
run(`spctl --assess --type open --context context:primary-signature --verbose=4 "${DMG}"`);

step("Packing and signing the update");
// The stapled .app, as the updater installs it. COPYFILE_DISABLE keeps
// macOS tar from adding AppleDouble "._" files for extended attributes.
run(`tar -czf "${UPDATE}" -C "${MACOS_BUNDLE_DIR}" Forgemark.app`, {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
// The password, and the key when it was given as its contents, go in the
// environment, not on the command line, where any process listing would
// show them. A key file goes by path: `signer sign` reads
// TAURI_SIGNING_PRIVATE_KEY as the key itself, unlike `tauri build`,
// which also takes a path there.
const keyIsFile = existsSync(updaterKey);
const signEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: updaterPassword };
if (keyIsFile) delete signEnv.TAURI_SIGNING_PRIVATE_KEY;
else signEnv.TAURI_SIGNING_PRIVATE_KEY = updaterKey;
run(
  keyIsFile
    ? `npx tauri signer sign --private-key-path "${updaterKey}" "${UPDATE}"`
    : `npx tauri signer sign "${UPDATE}"`,
  { env: signEnv },
);
if (!existsSync(`${UPDATE}.sig`)) bail(`Signing produced no ${UPDATE}.sig.`);

step("Done");
console.log(`  App: ${APP}`);
console.log(`  DMG: ${DMG}`);
console.log(`  Update: ${UPDATE} (+ .sig)`);
// Releases are immutable once published, so the release starts as a
// draft carrying the .dmg; pushing the tag then starts windows-release.yml,
// linux-release.yml and cli-release.yml, which add to that draft (and
// never create one), and `npm run release:publish` publishes it once
// every asset is there. The draft must exist before the tag is pushed.
console.log("\nNext steps (manual):");
console.log(`  1. Smoke-test the .dmg on a fresh macOS user account.`);
console.log(`  2. Create the draft release with the .dmg and the update:`);
console.log(
  `       gh release create v${VERSION} --draft \\\n` +
    `         --title "Forgemark v${VERSION}" \\\n` +
    `         --notes-file CHANGELOG.md \\\n` +
    `         "${DMG}#Forgemark ${VERSION} — universal macOS" \\\n` +
    `         "${UPDATE}" "${UPDATE}.sig"`,
);
console.log(`  3. Tag the commit you built and push the tag (starts the CI builds):`);
console.log(`       git tag v${VERSION} && git push origin v${VERSION}`);
console.log(`  4. When the Windows, Linux and CLI workflows have finished, publish:`);
console.log(`       npm run release:publish`);
