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
- AI-agent tests under `tests/ai/`. Never run in CI; run them manually with `RUN_AI_TESTS=1 npm run test:ai` or by giving an agent the skill plus one fixture/case pair.
- `tests/utils/flaky.ts` provides `flaky.flaky(...)` for tests that need a single logic retry. Use sparingly.

## Forward-compat markers

When a v1 implementation has a known v1.1 follow-up, leave a marker:

```ts
// TODO(forgemark-v1.1): replace with the diff drawer once we ship body-edit diff
```

These are greppable in CI and called out in the v1.1 planning meeting.

## File layout

```
src/                  # React + TS UI
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
- Optional local SDK harness: `RUN_AI_TESTS=1 npm run test:ai`. Requires `ANTHROPIC_API_KEY`.
- Never run in CI.
