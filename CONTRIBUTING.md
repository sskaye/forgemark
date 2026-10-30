# Contributing

Thanks for helping with Forgemark. Bug reports, ideas, documentation fixes and code are all welcome.

## Asking, reporting, suggesting

- **A question**, or something to show: start a thread in [Discussions](https://github.com/sskaye/forgemark/discussions).
- **A bug**: open a [bug report](https://github.com/sskaye/forgemark/issues/new?template=bug_report.yml). The most useful thing in one is a small file that shows the problem: a few lines of Markdown or HTML, with its comments block.
- **An idea** for something Forgemark should do: open a [feature request](https://github.com/sskaye/forgemark/issues/new?template=feature_request.yml).
- **A security problem**: report it privately, as [`SECURITY.md`](SECURITY.md) describes, not in an issue.

Forgemark is maintained by one person, so a reply can take a few days.

## Before you write code

Small fixes are welcome as they are: open the pull request. For anything larger, a new feature or a change to how the app or the file format behaves, open an issue first, so the approach is agreed before you spend time on it. The [file format](README.md#file-format) is read by other tools and by AI agents, so a change to what it writes needs particular care.

Issues labelled [`good first issue`](https://github.com/sskaye/forgemark/labels/good%20first%20issue) are a good place to start.

## Setting up

You need:

- Node.js 24, the version in [`.nvmrc`](.nvmrc) (`nvm use` picks it up), and npm 11 or later
- Rust, stable, via [rustup](https://rustup.rs/); [`rust-toolchain.toml`](src-tauri/rust-toolchain.toml) adds rustfmt and clippy
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ Build Tools
- Linux (Ubuntu 24.04 or later): `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

Then fork the repository on GitHub and:

```bash
git clone https://github.com/<you>/forgemark.git
cd forgemark
npm install
npm run dev        # the app, with hot reload
npm test           # unit and integration tests; no Tauri runtime needed
```

[`docs/architecture.md`](docs/architecture.md) is the map of the code: read the part for the area you're changing before you change it.

## Making a change

1. Branch from `main`: `feature/<slug>` for new behaviour, `fix/<slug>` for a bug, `chore/<slug>` for tooling, dependencies and refactors that change no behaviour.
2. Keep the change to one thing. A refactor and a behaviour change are two pull requests.
3. Add or update tests (see [Tests](#tests)). A bug fix comes with a test that fails without it.
4. Run what CI runs (see [Checks](#checks)).
5. If you changed anything under `assets/forgemark-skill/` or `src/format/`, run `npm run build:skill` and commit the rebuilt bundles; a test checks that they match the source.
6. If a user would notice the change, add a line under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), saying what they'll see.

## Checks

```bash
npm run lint && npm run typecheck && npm run format:check && npm test
npm run test:e2e   # browser tests, if you touched what the app shows
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI runs all of these on macOS, Windows and Linux, plus the macOS app build. `npm run format` fixes formatting.

## Dependencies

Dependabot opens update pull requests each Monday, grouped so that packages released together (Tiptap, CodeMirror, Tauri) come as one, and a security fix as soon as GitHub knows of one. The [Audit](.github/workflows/audit.yml) workflow fails when anything the app ships has a known high or critical vulnerability; it isn't a required check, but a release won't build until it passes.

Tauri's JavaScript packages and its Rust crates must be on the same minor version, and Dependabot updates them in separate pull requests. `npm run check:tauri` fails CI until they match: update the other side in the same pull request (`cd src-tauri && cargo update -p tauri -p tauri-plugin-…`, or `npm install @tauri-apps/…@x.y`).

## Code

- TypeScript strict mode is on and stays on.
- Prettier owns formatting and ESLint owns lint. Where they disagree, Prettier wins.
- React function components only.
- Named exports for shared modules.
- Async functions are named with verbs (`loadFile`, `saveDocument`); pure helpers are nouns where that reads well.
- Comments say why, not what, in plain sentences. Match the code around you.

## Tests

- Unit tests go in `tests/unit/`, integration tests in `tests/integration/`, browser tests in `tests/e2e/`, timing tests in `tests/perf/`.
- Integration tests mount the app through `tests/utils/harness.tsx` (`renderApp`, `LoadOnMount`) against the fake Tauri installed by `tests/setup.ts`. `fakeTauri` seeds files, fires watchers and answers dialogs. Don't render `DocumentBindings` yourself; `AppShell` mounts one per document. Most changes can be covered here.
- Rendering that needs a real browser goes in `tests/e2e/` (Playwright, against the Vite dev server).
- Timing assertions run only under `npm run test:perf`; the structural parts of those tests run every time.
- A test must pass every time. If one fails now and then, fix the test (usually a wait that's too short) rather than re-running it.
- Agent tests in `tests/ai/` give a live model the skill and a fixture and check what it writes. They are run by hand, never in CI. If your change affects the skill or the format, run the relevant case and record the outcome on its "Last run" line.

## Commits

- One subject line of 72 characters or fewer, in the imperative: "Add", not "Added".
- A body, wrapped at 72, that explains why, not what.
- `Fixes #123` in the body when the change fixes an issue, so it closes when the change merges.

## Pull requests

- Say what changed and why, and how you tested it. If a test can't see what you changed, say what you checked by hand.
- CI must pass before anything merges, and every change to `main`, the maintainer's included, goes through a pull request.
- The maintainer reviews pull requests from contributors and merges them. Expect questions; they're about getting the change right, not about turning it away.

## AI-assisted contributions

Using an AI tool is fine. You're responsible for what you submit: read it, understand it, run it, and be ready to answer questions about it. Say in a `Co-Authored-By:` trailer if a tool wrote a substantial part of the change. A pull request that looks generated and untested will be closed.

## Releases

Releases are made by the maintainer; see [`docs/releasing.md`](docs/releasing.md). A contributor doesn't change the version number.

## Layout

```
src/                the React and TypeScript app
src/format/         the file format: parsing, writing, finding anchors
cli/                the forgemark command-line tool, built from src/format
src-tauri/          the Tauri shell (Rust)
tests/              unit, integration, browser, perf and agent tests
assets/             the agent skill, sample documents, the app icon
docs/               architecture, the file format, releasing, examples
scripts/            build helpers: CLI bundle, skill packaging, icons, release
.github/            CI, release builds, issue forms
```

## Licence

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE), the same as the rest of Forgemark.

## Conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
