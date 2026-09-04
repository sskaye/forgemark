# Conventions

The short list for working in this repository. The code map is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); how to contribute is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Branches

- `feature/<slug>` for new behaviour.
- `fix/<slug>` for bug fixes.
- `chore/<slug>` for tooling, dependencies, and refactors with no behaviour change.

## Commits

- One subject line of 72 characters or fewer, in the imperative: "Add", not "Added".
- The body wraps at 72 and explains why, not what.
- A co-author trailer when the work was paired or written in substantial part by an AI tool.

## Code

- TypeScript strict mode is on and stays on.
- Prettier owns formatting and ESLint owns lint. Where they disagree, Prettier wins.
- React function components only.
- Named exports for shared modules.
- Async functions are named with verbs (`loadFile`, `saveDocument`); pure helpers are nouns where that reads well.

## Tests

- Unit tests in `tests/unit/`, integration tests in `tests/integration/`, browser tests in `tests/e2e/`, timing tests in `tests/perf/`.
- Integration tests mount the app through `tests/utils/harness.tsx` (`renderApp`, `LoadOnMount`) against the fake Tauri installed by `tests/setup.ts`. `fakeTauri` seeds files, fires watchers, and answers dialogs. Do not render `DocumentBindings` yourself; `AppShell` mounts one per document.
- Timing assertions run only under `npm run test:perf`; the structural parts of those tests run every time.
- Agent tests in `tests/ai/` are run by hand with a live model, never in CI. Each case file records its last run.

## Checks

```bash
npm run lint            # ESLint
npm run typecheck       # tsc
npm run format:check    # Prettier
npm test                # Vitest
```

CI runs these plus the Rust checks (`cargo fmt --check`, clippy with warnings as errors, `cargo test`), the browser tests, the macOS app build, and the Windows installer build.

## Layout

```
src/                React and TypeScript app
cli/                the forgemark command-line tool, built from src/format
src-tauri/          Tauri shell (Rust)
tests/              all test code
assets/             the skill package, sample documents, the app icon
docs/               architecture notes, example files, design reviews and plans
scripts/            build helpers
.github/workflows/  CI and the Windows release build
```
