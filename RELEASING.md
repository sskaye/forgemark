# Releasing Forgemark

Cuts a signed, notarized macOS `.dmg` and a signed Windows `.msi`. Everything outside the bullet labelled **Manual** is reproducible from a clean checkout.

## Pre-flight

- `npm run build:skill` — regenerate the skill bundle. Commit the produced `assets/forgemark-skill.skill` and `.zip` if they changed.
- `npm test` — green.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run build:icons` — only if `assets/forgemark-icon.svg` changed.
- Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to match.
- Update `CHANGELOG.md` with the release line.

## Environment variables

Both signing identities are environment-variable inputs — do not commit them.

```sh
# macOS code signing (Tauri reads APPLE_* automatically)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
# An app-specific password (https://appleid.apple.com → Sign-In and Security)
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"

# Windows code signing (Tauri reads WIX_* and SIGNTOOL_* if present)
# Use Azure Key Vault, an EV Code Signing certificate, or a HSM
# token; do NOT keep a .pfx in the repo.
export WINDOWS_SIGNING_PFX_PATH="/path/to/cert.pfx"
export WINDOWS_SIGNING_PFX_PASSWORD="..."
```

## Build commands

```sh
# macOS
npm run build  # produces src-tauri/target/release/bundle/dmg/Forgemark_<ver>_universal.dmg

# Windows (run on Windows or via cross-build runner)
npm run build  # produces src-tauri/target/release/bundle/msi/Forgemark_<ver>_x64_en-US.msi
```

The `npm run build` step calls `tauri build`. If `APPLE_SIGNING_IDENTITY` is set, Tauri signs and notarizes during the build via the standard macOS toolchain (`codesign` + `notarytool`). On the first run the notarization step takes 5–15 minutes while Apple's service inspects the build.

## Verify

```sh
# Confirm the .dmg is signed and notarized.
codesign -dv --verbose=4 path/to/Forgemark.app
spctl --assess --verbose=4 path/to/Forgemark.app

# Confirm hardened runtime + entitlements.
codesign -d --entitlements - path/to/Forgemark.app
```

The output should include `Authority=Developer ID Application: …`, `flags=0x10000(runtime)`, and the four entitlements from `src-tauri/entitlements.plist`.

## Smoke test

On a fresh user account (no Xcode, no Forgemark installed):

1. Mount the `.dmg`, drag the app to `/Applications`, eject.
2. Launch — should open without a Gatekeeper prompt.
3. ⌘O a markdown file, add a comment, save, quit.
4. Re-launch — comment persists.

A Gatekeeper prompt on a fresh account means the notarization stapler didn't run; investigate before tagging the release.

## Tag and publish

```sh
git tag -s v1.0.0 -m "Forgemark v1.0.0"
git push origin v1.0.0
# Attach .dmg and .msi to the GitHub release.
```

## Auto-update

Auto-update infrastructure is **deferred to v1.1**. Until then, releases are manual: ship the new build to the GitHub release page, users redownload.

## Manual

- Cross-platform validation pass on Windows: open every fixture under `tests/ai/fixtures/`, run through the six storyboard flows from `docs/design_handoff_v1_1/README.md` §13, capture screenshots, compare against the macOS baseline.
- Manual end-to-end with **Claude Code**: install the `.skill`, open the production sample, run every prompt from `tests/ai/cases/*.md`. Expected: all PASS.
- Manual end-to-end with **Codex CLI**: extract the `.zip` to `~/.agents/skills/forgemark/`, same exercise.
