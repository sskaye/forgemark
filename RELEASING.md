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
# Bump the version everywhere it's recorded (four files, all must agree):
#   npm run version:set 1.5.0
# Then update CHANGELOG.md with the new release line.

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

**A note on `assets/forgemark-skill.{skill,zip}`.** Step 2 rebuilds them, and
zip metadata means the bytes can differ even when nothing in the source
changed — so the working tree may look dirty after a release build. Check
whether the _contents_ actually changed before committing:

```sh
npm test -- skill-bundle    # asserts every bundled file matches its source
```

If that passes, the diff is metadata noise and you can `git checkout -- assets/`.

## Smoke test

On a fresh macOS user account (no Xcode, no Forgemark installed):

1. Mount the `.dmg`, drag the app to `/Applications`, eject.
2. Launch — should open without a Gatekeeper prompt at all.
3. First-run welcome appears → click **Open sample →**.
4. Add a comment, ⌘S, quit, relaunch — comment persists.

A Gatekeeper prompt on a fresh account means the staple didn't apply; rerun `xcrun stapler validate` on both artifacts and investigate before tagging.

## Tag and publish

One command does the whole thing. `--target` makes `gh` create the tag on the
remote itself, which both publishes the release and starts
`windows-release.yml` — so there is no separate `git push origin <tag>` step,
and no race with the workflow over who creates the release.

```sh
gh release create v<ver> --target main \
  --title "Forgemark v<ver>" \
  --notes-file CHANGELOG.md \
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Forgemark_<ver>_universal.dmg#Forgemark <ver> — universal macOS"

git fetch origin --tags   # pull the tag gh just created back down
```

The Windows installers appear on the release a few minutes later.

**Don't** create the tag locally first and push it: `gh release create` refuses
to run against a tag that exists only locally, and pushing the tag starts the
Windows workflow, which creates the release itself if one doesn't exist — so
you end up racing it. If you specifically want an _annotated_ tag, push it
first and then use `gh release edit --notes-file` plus `gh release upload`
instead of `create`.

## Windows

Automated via GitHub Actions (`.github/workflows/windows-release.yml`) on a
`windows-latest` runner. It runs on every `v*` tag push and attaches the
**unsigned** `.msi` (WiX) and `-setup.exe` (NSIS) to that tag's GitHub release
(creating the release if it doesn't exist yet). No Windows machine required.

To backfill a release tagged before the workflow existed, run it manually:

```sh
gh workflow run windows-release.yml -f tag=v<ver>
```

Output assets: `Forgemark_<ver>_x64_en-US.msi` and `Forgemark_<ver>_x64-setup.exe`.

### Code signing (not enabled)

The Windows installers are currently **unsigned**, so users hit a SmartScreen
"Windows protected your PC" prompt (→ **More info** → **Run anyway**). See the
README's "Installing on Windows (unsigned)" note.

To sign later without a hardware token, the modern path is **Azure Trusted
Signing** (~$10/mo): add the `azure/trusted-signing-action` step to the workflow
after the build and before the upload, or set `bundle.windows.signCommand` in
`tauri.conf.json`. EV certs on a USB token give instant SmartScreen reputation
but don't fit headless CI. The legacy `WINDOWS_SIGNING_PFX_PATH` /
`WINDOWS_SIGNING_PFX_PASSWORD` env-var path only works if you already hold a
`.pfx` — new OV/EV certs can no longer be issued as downloadable `.pfx` files.

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
