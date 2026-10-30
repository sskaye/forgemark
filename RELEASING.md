# Releasing Forgemark

Cuts a signed, notarized macOS `.dmg`, the Windows installer, the Linux AppImages, and the command-line tool. Everything outside the bullet labelled **Manual** is reproducible from a clean checkout.

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

### Immutable releases

The repository has **immutable releases** turned on (Settings → General →
Releases), so a published release's assets and tag can't be changed or
added to. Tools that pin a version, such as a CI job downloading
`forgemark-cli-<ver>.mjs` and checking its checksum, rely on that. To check
it's still on:

```sh
gh api repos/sskaye/forgemark/immutable-releases   # {"enabled":true,...}
```

It is why every release is assembled as a draft and published last, below.

### Updater signing key

The app updates itself (README, "Updates"): it downloads a newer release and
installs it only if its signature checks out against the public key built into
the app (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). The private
key signs every update file. It is separate from Apple's certificate, and
**losing it, or its password, means installed copies can never update
themselves again**: everyone would have to download by hand once, onto a build
with a new key.

1. Generate it, choosing a password when asked:
   ```sh
   npx tauri signer generate -w ~/.tauri/forgemark-updater.key
   ```
2. Put the public key (`~/.tauri/forgemark-updater.key.pub`) in
   `plugins.updater.pubkey` and commit it. It isn't secret.
3. Store the password in the Keychain, where `npm run release` reads it:
   ```sh
   security add-generic-password -a forgemark -s forgemark-updater-key-password -w
   ```
4. Give the Windows and Linux release workflows the key and password:
   ```sh
   gh secret set TAURI_SIGNING_PRIVATE_KEY --repo sskaye/forgemark < ~/.tauri/forgemark-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo sskaye/forgemark
   ```
5. Back up the key file and the password, e.g. in a password manager.

`npm run release` stops before building if it can't find the key or the
password. `TAURI_SIGNING_PRIVATE_KEY` (a path or the key itself) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` override the defaults.

## Each release

The `npm run release` script captures every step of the macOS build/sign/notarize flow. Run it from a clean working tree.

```sh
# Bump the version everywhere it's recorded (four files, all must agree):
#   npm run version:set 1.5.0
# Then update CHANGELOG.md with the new release line, and rebuild the
# skill, which embeds the version in the CLI and the manifest:
#   npm run build:skill
# Commit all of that; the release pre-flight's tests check both.

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
7. Packs the stapled `.app` as the in-app update, `Forgemark_<ver>_universal.app.tar.gz`, and signs it with the updater key (`.sig` beside it).

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

A published release can't be added to, so the release is assembled as a
draft and published only when every asset is on it. A release carries seven
files and nothing else: the macOS `.dmg` and its update (`.app.tar.gz`),
the Windows `-setup.exe`, the two Linux `.AppImage`s, the CLI, and
`latest.json`. Five steps, in this order:

```sh
# 1. The draft, carrying the .dmg and the macOS update. A draft holds no
#    tag yet. (`npm run release` prints this with the paths filled in.)
gh release create v<ver> --draft \
  --title "Forgemark v<ver>" \
  --notes-file CHANGELOG.md \
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Forgemark_<ver>_universal.dmg#Forgemark <ver> — universal macOS" \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/Forgemark_<ver>_universal.app.tar.gz \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/Forgemark_<ver>_universal.app.tar.gz.sig

# 2. Tag the commit you built (it should be origin/main) and push the tag.
#    That starts windows-release.yml, linux-release.yml and cli-release.yml.
git tag v<ver> && git push origin v<ver>

# 3. Wait for the three workflows to finish.
gh run list --branch v<ver>

# 4. Publish. Writes latest.json, the updater's manifest, from the update
#    files' signatures and attaches it; then refuses unless the tag is on
#    GitHub, the seven assets are on the draft and nothing else is,
#    latest.json points only at files the release has, and the CLI asset
#    is the bundle committed at the tag. It takes the .sig files off the
#    draft (latest.json carries the signatures) and publishes.
npm run release:publish

# 5. Once whatever pins a version has moved to this one (ForgeGraph
#    downloads its CLI from its version's release), delete the older
#    releases, keeping their tags, so the Releases page lists only this
#    one. Without --yes it lists what it would delete.
npm run release:prune -- --yes
```

**Create the draft before pushing the tag.** The workflows add to the draft
and never create a release: a draft holds no tag, so two jobs that each
created one would leave two drafts for one version. A workflow that finds no
draft fails and says so; create the draft and re-run the failed jobs. The
upload step lives in `scripts/release-attach.sh`, shared by all three
workflows. It never replaces an asset, so re-running a job that already
uploaded fails on the name: delete that asset from the draft first.

If a check in step 4 fails, nothing is published and the draft stays as it
is. Once published, a mistake can't be patched in place: cut a new version.

## Windows

Automated via GitHub Actions (`.github/workflows/windows-release.yml`) on a
`windows-latest` runner. It runs on every `v*` tag push and attaches the
**unsigned** NSIS `-setup.exe`, and its updater signature, to that tag's draft release.
No Windows machine required.

To backfill a release tagged before the workflow existed (and published
before releases became immutable), run it manually:

```sh
gh workflow run windows-release.yml -f tag=v<ver>
```

Output asset: `Forgemark_<ver>_x64-setup.exe`. Releases before 1.12.1 also
carried an `.msi`, which did the same job; an MSI install updates through
the `-setup.exe`.

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

## Linux

Automated via GitHub Actions (`.github/workflows/linux-release.yml`) on
`ubuntu-24.04` and `ubuntu-24.04-arm` runners. Like the Windows workflow, it
runs on every `v*` tag push and attaches each architecture's AppImage, and
its updater signature, to that tag's draft release. No Linux machine
required.

Output assets: `Forgemark_<ver>_amd64.AppImage` and
`Forgemark_<ver>_aarch64.AppImage`. The AppImage runs on any distribution
and the in-app updater can replace it. Releases before 1.12.1 also carried
a `.deb` per architecture, which the updater can't replace; the app offers
a `.deb` install the AppImage instead.

Building on Ubuntu 24.04 sets the floor: the AppImage needs its glibc and
WebKitGTK 4.1. Linux packages need no code signing.

A pull request that touches the Linux packaging (the workflow, the bundle
config, `src-tauri/linux/`, or `src-tauri/src/main.rs`) builds the AppImages
too, and keeps them on the run as artifacts for testing by hand, without
touching any release.

To backfill a release, run it manually:

```sh
gh workflow run linux-release.yml -f tag=v<ver>
```

## Command-line tool

Automated via GitHub Actions (`.github/workflows/cli-release.yml`). On every
`v*` tag push it attaches the CLI bundle committed at the tag, so other
projects can install a pinned version without the app or the skill. It runs
the bundle on Node 18, the oldest the bundle supports, and fails if the
version the bundle reports isn't the tag's.

Output assets:

- `forgemark-cli-<ver>.mjs` — `assets/forgemark-skill/scripts/forgemark.mjs`
  at the tag, byte for byte. One file, no dependencies, Node 18 or later.
  Forgemark's MIT licence is at its start and the notices of the packages it
  bundles at its end (`scripts/build-cli.mjs` writes them). GitHub shows its
  SHA-256 on the release.

A consumer pins a version and its SHA-256, as ForgeGraph does, and moves the
pin when a new release comes out, since only the latest release is kept:

```sh
v=1.12.1
sha=<the SHA-256 shown beside forgemark-cli-$v.mjs>
curl -fsSLO "https://github.com/sskaye/forgemark/releases/download/v$v/forgemark-cli-$v.mjs"
echo "$sha  forgemark-cli-$v.mjs" | sha256sum -c -
node "forgemark-cli-$v.mjs" --version
```

The skill has a 640 KB size budget (`scripts/build-skill.mjs`), and the
bundle, notices included, is most of it: about 505 KB of the 525 KB total
after `reattach --all`.

## In-app updates

Every release carries what the app's updater needs: each platform's update
file, and `latest.json`, which lists them by platform with each one's
signature. The `.sig` files the builds make are read into it at publish
time and don't stay on the release. The app
reads `latest.json` from the latest published release
(`releases/latest/download/latest.json`), so publishing a release is what
offers it to installed copies.

| Platform | Update file                                                 | Signed by             |
| -------- | ----------------------------------------------------------- | --------------------- |
| macOS    | `Forgemark_<ver>_universal.app.tar.gz` (both architectures) | `npm run release`     |
| Windows  | the NSIS `-setup.exe`                                       | `windows-release.yml` |
| Linux    | each architecture's `.AppImage`                             | `linux-release.yml`   |

A `.deb` install (from a release before 1.12.1) is a system package the
updater can't replace; the app offers it the AppImage's download instead. Release builds turn the update files on through
`src-tauri/tauri.release.conf.json`; a pull request's Linux build doesn't use
it and needs no secrets.

A release that ships a broken update can't be fixed in place, being
immutable: publish a fixed version, which installed copies then find.

## Manual

- Cross-platform validation pass on Windows: open every fixture under
  `tests/ai/fixtures/`, then exercise the core flows from
  `docs/ARCHITECTURE.md`: add a comment, suggest/accept/reject an edit,
  recover a lost anchor, use Settings skill download, run Clean Export, and
  verify external-change conflict handling where practical.
- The same pass on Ubuntu 24.04 (a Wayland session, the default), from the
  AppImage. Also: open a `.md` file with it (`./Forgemark…AppImage file.md`)
  with the app closed and again with it open; print; open an HTML report from
  `docs/example_file/testing/` and comment on it; edit the open file in
  another editor and check the conflict banner appears.
- Manual end-to-end with **Claude Code**: install the `.skill`, open the production sample, run every prompt from `tests/ai/cases/*.md`. Expected: all PASS.
- Manual end-to-end with **Codex CLI**: extract the `.zip` to `~/.agents/skills/forgemark/`, same exercise.
