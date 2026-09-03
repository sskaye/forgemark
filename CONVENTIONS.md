# Forgemark conventions

Quick reference for engineers working in this repo. For the current code map, read `docs/ARCHITECTURE.md`.

## Branch naming

- `feature/<short-slug>` — new user-facing behavior.
- `fix/<short-slug>` — bug fixes outside the phase cadence.
- `chore/<short-slug>` — tooling, deps, refactors with no behavior change.

## Commit messages

- One subject line ≤ 72 chars, imperative mood ("Add foo," not "Added foo").
- Body wraps at 72; explain _why_, not _what_.
- Co-author trailer when work was paired or AI-assisted.

## Code style

- TypeScript strict mode is on; don't relax it locally.
- Prettier owns formatting; ESLint owns lint. Conflicts: Prettier wins.
- React function components only; no class components.
- Avoid default exports for shared modules; named exports are easier to refactor.
- Async functions are named with verbs (`loadFile`, `saveDoc`); pure helpers are nouns where reasonable.

## Testing

- Unit tests live next to source as `<file>.test.ts(x)` OR in `tests/unit/`.
- Integration tests under `tests/integration/`.
- E2E tests under `tests/e2e/`.
- AI-agent cases under `tests/ai/`: a prompt, expectations, and the last run's outcome, run by hand by giving a sub-agent the skill plus one fixture. Never run in CI.
- Integration tests mount the app through `tests/utils/harness.tsx` (`renderApp`, `LoadOnMount`) against the fake Tauri installed by `tests/setup.ts` (`fakeTauri` seeds files, fires watchers, and sets dialog answers). Don't render `DocumentBindings` yourself: `AppShell` mounts one per document.
- Timing assertions run only under `npm run test:perf`; the structural parts of those tests run every time.

## Forward-compat markers

When a v1 implementation has a known v1.1 follow-up, leave a marker:

```ts
// TODO(forgemark-v1.1): replace with the diff drawer once we ship body-edit diff
```

These are greppable in CI and called out in the v1.1 planning meeting.

## File layout

```
src/                  # React + TS UI
cli/                  # The forgemark CLI (Node), built from src/format
src-tauri/            # Tauri shell (Rust)
tests/                # All test code
docs/                 # Current architecture notes and retained token source
assets/               # Skill package, sample files, app icon sources
.github/workflows/    # CI (no AI tests)
```

## Pre-commit

The `package.json` exposes:

- `npm run lint` — ESLint over `src` and `tests`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest, no AI tests.
- `npm run format:check` — Prettier check.

A pre-commit hook can run all four; not enforced, just recommended.

## AI testing

- Primary path: invoke a sub-agent in Claude Code with a fixture + `assets/forgemark-skill/SKILL.md` + a prompt from `tests/ai/cases/<category>.md`. Capture the run summary in the PR description.
- Record the run's outcome in the case file's "Last run" line.
- Never run in CI.
