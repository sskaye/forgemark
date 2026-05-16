# Releasing Forgemark

Cuts a signed, notarized macOS `.dmg` and a signed Windows `.msi`. Everything outside the bullet labelled **Manual** is reproducible from a clean checkout.

## One-time setup

### macOS code-signing identity

1. **Apple Developer Program membership** ($99/yr).
2. **Developer ID Application certificate** — Apple Developer portal → Certificates, IDs & Profiles → `+` → Developer ID Application → G2 Sub-CA. Download the `.cer`, double-click to install in your **login** keychain.
3. **Confirm the cert is recognised:**
   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   # 1) ABCDEF1234... "Developer ID Application: Your Name (XXXXXXXXXX)"
   ```
   Copy the string in quotes — that's your `APPLE_SIGNING_IDENTITY`.
4. **App-specific password** — https://appleid.apple.com → Sign-In and Security → App-Specific Passwords. Format is `xxxx-xxxx-xxxx-xxxx`. **Do not** use your Apple account password.
5. **Stash credentials in Keychain** so you don't have to paste the password ever again:
   ```sh
   xcrun notarytool store-credentials forgemark-notary \
     --apple-id "you@example.com" \
     --team-id "XXXXXXXXXX" \
     --password "xxxx-xxxx-xxxx-xxxx"
   ```

### Cross-arch toolchain

```sh
rustup target add x86_64-apple-darwin   # one-time; aarch64 already added by tauri install
```

## Each release

The `npm run release` script captures every step of the macOS build/sign/notarize flow. Run it from a clean working tree.

```sh
# Bump versions in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
# (all three must agree — there's no script for this yet).
# Update CHANGELOG.md with the new release line.

export APPLE_KEYCHAIN_PROFILE=forgemark-notary
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"

npm run release
```

The script:

1. Runs lint, typecheck, full test suite.
2. Rebuilds `assets/forgemark-skill.{skill,zip}` from source.
3. Builds the universal Tauri bundle (Intel + Apple Silicon in one `.app`).
4. Submits the resulting `.dmg` to Apple's notary service via `notarytool` and waits.
5. Staples the notarization ticket onto the `.dmg`.
6. Verifies signatures, Gatekeeper assessment, and staple validity for both the `.app` and the `.dmg`.

Final artifact lands at:

```
src-tauri/target/universal-apple-darwin/release/bundle/dmg/Forgemark_<ver>_universal.dmg
```

If you don't have a Keychain profile set up, the script falls back to `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` env vars.

## Smoke test

On a fresh macOS user account (no Xcode, no Forgemark installed):

1. Mount the `.dmg`, drag the app to `/Applications`, eject.
2. Launch — should open without a Gatekeeper prompt at all.
3. First-run welcome appears → click **Open sample →**.
4. Add a comment, ⌘S, quit, relaunch — comment persists.

A Gatekeeper prompt on a fresh account means the staple didn't apply; rerun `xcrun stapler validate` on both artifacts and investigate before tagging.

## Tag and publish

```sh
git tag -a v<ver> -m "Forgemark v<ver>"
git push origin v<ver>

gh release create v<ver> \
  --title "Forgemark v<ver>" \
  --notes-file CHANGELOG.md \
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Forgemark_<ver>_universal.dmg#Forgemark <ver> — universal macOS"
```

(Tag signing requires GPG or SSH-based signing — drop `-s` if neither is set up.)

## Windows

Not yet automated. Set the Windows env vars and run `npm run build` on a Windows machine:

```sh
export WINDOWS_SIGNING_PFX_PATH="/path/to/cert.pfx"
export WINDOWS_SIGNING_PFX_PASSWORD="..."
```

Use Azure Key Vault, an EV Code Signing certificate, or an HSM token — do **not** keep a `.pfx` in the repo. Output: `src-tauri/target/release/bundle/msi/Forgemark_<ver>_x64_en-US.msi`.

A Windows-equivalent of `npm run release` is the natural next investment if Forgemark gets a regular Windows release cadence.

## Auto-update

Auto-update infrastructure is **deferred to v1.1**. Until then, releases are manual: ship the new build to the GitHub release page, users redownload.

## Manual

- Cross-platform validation pass on Windows: open every fixture under
  `tests/ai/fixtures/`, then exercise the core flows from
  `docs/ARCHITECTURE.md`: add a comment, suggest/accept/reject an edit,
  recover a lost anchor, use Settings skill download, run Clean Export, and
  verify external-change conflict handling where practical.
- Manual end-to-end with **Claude Code**: install the `.skill`, open the production sample, run every prompt from `tests/ai/cases/*.md`. Expected: all PASS.
- Manual end-to-end with **Codex CLI**: extract the `.zip` to `~/.agents/skills/forgemark/`, same exercise.
