# Releasing Forgemark

Cuts a signed, notarized macOS `.dmg`, the Windows installer, the Linux AppImages, and the command-line tool, each built by a GitHub workflow when the version's tag is pushed. Everything outside the bullet labelled **Manual** is reproducible from a clean checkout.

## One-time setup

### macOS code-signing identity

1. **Apple Developer Program membership** ($99/yr).
2. **Developer ID Application certificate** — Apple Developer portal → Certificates, IDs & Profiles → `+` → Developer ID Application → G2 Sub-CA. Download the `.cer`, double-click to install in your **login** keychain.
3. **Confirm the cert is recognised:**
   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   It prints a line like `1) ABCDEF1234... "Developer ID Application: Your Name (XXXXXXXXXX)"`. The string in quotes is your `APPLE_SIGNING_IDENTITY`.
4. **App-specific password** — https://appleid.apple.com → Sign-In and Security → App-Specific Passwords. Format is `xxxx-xxxx-xxxx-xxxx`. **Do not** use your Apple account password.
5. **Stash credentials in Keychain** so you don't have to paste the password ever again:
   ```sh
   xcrun notarytool store-credentials forgemark-notary \
     --apple-id "you@example.com" \
     --team-id "XXXXXXXXXX" \
     --password "xxxx-xxxx-xxxx-xxxx"
   ```

### macOS in CI

`macos-release.yml` signs and notarizes on a GitHub runner, with the same
certificate and Apple ID, given as repository secrets. Set them once, from
the Mac that holds the certificate:

1. In Keychain Access, choose the **login** keychain and the **My
   Certificates** tab, right-click **Developer ID Application: …** (it has
   its private key beneath it), and Export it as **Personal Information
   Exchange (.p12)**, named `developer-id`, on the Desktop. Choose a
   password for the file, and allow access to the key when asked.
2. Make an app-specific password for the notary service
   (https://appleid.apple.com → Sign-In and Security → App-Specific
   Passwords). The one in the `forgemark-notary` profile can't be read back.
3. Encode the certificate, and check the result isn't empty (about 4,300
   bytes):

   ```sh
   base64 -i ~/Desktop/developer-id.p12 -o ~/Desktop/developer-id.b64
   ```

   ```sh
   wc -c ~/Desktop/developer-id.b64
   ```

4. Set the six secrets, one command at a time. Without `--body`, `gh`
   asks for the value and doesn't echo it: for `APPLE_CERTIFICATE_PASSWORD`
   the `.p12`'s password, for `APPLE_ID` the Apple account's email, for
   `APPLE_PASSWORD` the app-specific password.

   ```sh
   gh secret set APPLE_CERTIFICATE --repo sskaye/forgemark < ~/Desktop/developer-id.b64
   ```

   ```sh
   gh secret set APPLE_CERTIFICATE_PASSWORD --repo sskaye/forgemark
   ```

   ```sh
   gh secret set APPLE_SIGNING_IDENTITY --repo sskaye/forgemark --body "Developer ID Application: Your Name (XXXXXXXXXX)"
   ```

   ```sh
   gh secret set APPLE_ID --repo sskaye/forgemark
   ```

   ```sh
   gh secret set APPLE_PASSWORD --repo sskaye/forgemark
   ```

   ```sh
   gh secret set APPLE_TEAM_ID --repo sskaye/forgemark --body "XXXXXXXXXX"
   ```

5. Delete both files:

   ```sh
   rm ~/Desktop/developer-id.p12 ~/Desktop/developer-id.b64
   ```

Piping `base64` straight into `gh secret set` once stored an empty
certificate here; the file in between, and its size, show what's being
sent. If the macOS job's log shows `APPLE_CERTIFICATE:` with nothing after
it (a set secret shows `***`), the secret is empty: set it again.

The workflow also uses the updater key's secrets (below), which the Windows
and Linux workflows already have. Until `APPLE_CERTIFICATE` and `APPLE_ID`
are set, it builds nothing and says so, and the macOS files come from
`npm run release` on a Mac (below, "Building macOS by hand").

When the certificate is renewed, export and set `APPLE_CERTIFICATE` and
its password again.

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
4. Give the macOS, Windows and Linux release workflows the key and password:
   ```sh
   gh secret set TAURI_SIGNING_PRIVATE_KEY --repo sskaye/forgemark < ~/.tauri/forgemark-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo sskaye/forgemark
   ```
5. Back up the key file and the password, e.g. in a password manager.

`npm run release` stops before building if it can't find the key or the
password. `TAURI_SIGNING_PRIVATE_KEY` (a path or the key itself) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` override the defaults.

## Each release

A published release can't be changed or added to, so each one is assembled
as a draft and published only when every file is on it. A release carries
seven files and nothing else: the macOS `.dmg` and its update
(`.app.tar.gz`), the Windows `-setup.exe`, the two Linux `.AppImage`s, the
CLI, and `latest.json`.

1. **Bump the version** in a pull request:

   ```sh
   npm run version:set 1.13.0   # the four files that record it
   # In CHANGELOG.md, rename "## [Unreleased]" to "## [1.13.0] — <date>".
   npm run build:skill           # the CLI and the skill manifest embed the version
   ```

   Commit, open the pull request, and let it merge.

2. **Start the release**, from `main`, up to date:

   ```sh
   git checkout main && git pull
   npm run release:start
   ```

   It checks that the tree is clean, `HEAD` is `origin/main`, the tag and
   release don't exist yet and the changelog has the version's section. Then
   it creates the draft, with that section as its notes, tags `HEAD` and
   pushes the tag. The tag starts four workflows, each adding its files to
   the draft:

   | Workflow              | Adds                                             |
   | --------------------- | ------------------------------------------------ |
   | `macos-release.yml`   | the `.dmg`, the `.app.tar.gz` update, its `.sig` |
   | `windows-release.yml` | the `-setup.exe` and its `.sig`                  |
   | `linux-release.yml`   | the two `.AppImage`s and their `.sig`s           |
   | `cli-release.yml`     | `forgemark-cli-<ver>.mjs`                        |

3. **Wait for them**: `gh run list --branch v1.13.0`.

4. **Smoke-test the `.dmg`** (below), downloaded from the draft:

   ```sh
   gh release download v1.13.0 --pattern '*.dmg' --dir /tmp
   ```

5. **Publish**:

   ```sh
   npm run release:publish
   ```

   It writes `latest.json`, the updater's manifest, from the update files'
   signatures and attaches it. Then it refuses unless the tag is on GitHub,
   the seven files are on the draft and nothing else is, `latest.json`
   points only at files the release has, and the CLI file is the bundle
   committed at the tag. It takes the `.sig` files off (`latest.json`
   carries the signatures) and publishes. If a check fails, nothing is
   published and the draft stays as it is. Once published, a mistake can't
   be patched in place: cut a new version.

6. **Prune the older releases**, once whatever pins a version has moved to
   this one (ForgeGraph downloads its CLI from its version's release), so
   the Releases page lists only the latest. Their tags stay. Without
   `--yes` it lists what it would delete.

   ```sh
   npm run release:prune -- --yes
   ```

**The workflows never create a release.** A draft holds no tag, so two jobs
that each created one would leave two drafts for one version; that's why
`release:start` creates the draft before pushing the tag. A workflow that
finds no draft fails and says so: create the draft and re-run the failed
jobs. The upload step is `scripts/release-attach.sh`, shared by all four. It
never replaces a file, so re-running a job that already uploaded fails on
the name: delete that file from the draft first.

## Building macOS by hand

`macos-release.yml` runs `npm run release` (`scripts/release.mjs`) on a
macOS runner. Run on a Mac, the same script is the fallback, for when the
workflow can't run or its secrets aren't set (the job then says so and
builds nothing). From a clean checkout of the tag:

```sh
export APPLE_KEYCHAIN_PROFILE=forgemark-notary
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"
npm run release
```

The script:

1. Checks the Tauri versions and audits what the app ships. By hand, it also
   runs lint, typecheck and the tests, and rebuilds the skill bundle; in CI,
   the commit was checked before it reached `main`.
2. Builds the universal Tauri bundle (Intel + Apple Silicon in one `.app`).
3. Submits the `.dmg` to Apple's notary service via `notarytool` and waits.
4. Staples the notarization ticket onto the `.app` and the `.dmg`.
5. Verifies signatures, Gatekeeper assessment, and staple validity for both.
6. Packs the stapled `.app` as the in-app update,
   `Forgemark_<ver>_universal.app.tar.gz`, and signs it with the updater key
   (`.sig` beside it).

It prints the command that attaches the three files to the draft
(`scripts/release-attach.sh`). Without a Keychain profile, it uses
`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` instead.

**A note on `assets/forgemark-skill.skill`.** By hand, step 1 rebuilds it,
and zip metadata means the bytes can differ even when nothing in the source
changed, so the working tree may look dirty afterwards. Check whether the
_contents_ changed:

```sh
npm test -- skill-bundle    # asserts every bundled file matches its source
```

If that passes, the diff is metadata noise: `git checkout -- assets/`.

## Smoke test

On a fresh macOS user account (no Xcode, no Forgemark installed):

1. Mount the `.dmg`, drag the app to `/Applications`, eject.
2. Launch — should open without a Gatekeeper prompt at all.
3. First-run welcome appears → click **Open sample →**.
4. Add a comment, ⌘S, quit, relaunch — comment persists.

A Gatekeeper prompt on a fresh account means the staple didn't apply; run
`xcrun stapler validate` on both files and investigate before publishing.

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
| macOS    | `Forgemark_<ver>_universal.app.tar.gz` (both architectures) | `macos-release.yml`   |
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
  `docs/architecture.md`: add a comment, suggest/accept/reject an edit,
  recover a lost anchor, use Settings skill download, run Clean Export, and
  verify external-change conflict handling where practical.
- The same pass on Ubuntu 24.04 (a Wayland session, the default), from the
  AppImage. Also: open a `.md` file with it (`./Forgemark…AppImage file.md`)
  with the app closed and again with it open; print; open an HTML report from
  `tests/fixtures/showcase/` and comment on it; edit the open file in
  another editor and check the conflict banner appears.
- Manual end-to-end with **Claude Code**: install the `.skill`, open the production sample, run every prompt from `tests/ai/cases/*.md`. Expected: all PASS.
- Manual end-to-end with **Codex CLI**: extract the `.zip` to `~/.agents/skills/forgemark/`, same exercise.
