#!/usr/bin/env node
// Release-build pipeline for the macOS universal binary.
//
// Captures the full sequence so the next release isn't a rediscovery:
//   1. Pre-flight (lint / typecheck / test / build:skill)
//   2. Universal Tauri build (Intel + Apple Silicon in one .app)
//   3. Notarize the .dmg (Tauri only notarizes the inner .app)
//   4. Staple the .dmg ticket
//   5. Verify codesign + Gatekeeper + staple on both .app and .dmg
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

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
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

step("Pre-flight checks");
run("npm run lint");
run("npm run typecheck");
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
  run(
    `xcrun notarytool submit "${DMG}" ` +
      `--apple-id "${process.env.APPLE_ID}" ` +
      `--password "${process.env.APPLE_PASSWORD}" ` +
      `--team-id "${process.env.APPLE_TEAM_ID}" ` +
      `--wait`,
  );
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

step("Done");
console.log(`  App: ${APP}`);
console.log(`  DMG: ${DMG}`);
console.log("\nNext steps (manual):");
console.log(`  1. Smoke-test the .dmg on a fresh macOS user account.`);
console.log(`  2. Tag and push:`);
console.log(`       git tag -a v${VERSION} -m "Forgemark v${VERSION}"`);
console.log(`       git push origin v${VERSION}`);
console.log(`  3. Publish on GitHub:`);
console.log(
  `       gh release create v${VERSION} --title "Forgemark v${VERSION}" \\\n` +
    `         --notes-file CHANGELOG.md \\\n` +
    `         "${DMG}#Forgemark ${VERSION} — universal macOS"`,
);
