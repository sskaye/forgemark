# Contributing

Forgemark is maintained by one person, and every change to `main` goes through a pull request that the maintainer reviews. Small fixes are welcome as they are. For anything larger, open an issue first so the approach can be agreed before the work is done.

## Setting up

See [Build](README.md#build) in the README. `npm run dev` opens the app; `npm test` runs the unit and integration tests, which need no Tauri runtime.

## Making a change

1. Branch from `main`: `feature/<slug>`, `fix/<slug>`, or `chore/<slug>`.
2. Keep the change to one thing. A refactor and a behaviour change are two pull requests.
3. Add or update tests. The suite mounts the app through `tests/utils/harness.tsx` against a fake of the Tauri plugins; most changes can be covered there. Rendering that needs a real browser goes in `tests/e2e/`.
4. Before pushing, run what CI runs:

   ```bash
   npm run lint && npm run typecheck && npm run format:check && npm test
   cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```

5. If you changed anything under `assets/forgemark-skill/`, run `npm run build:skill` and commit the rebuilt bundles; a test checks that they match the source.
6. Add a line to the unreleased section of `CHANGELOG.md` if a user would notice the change.

## Pull requests

- Describe what changed and why, and how you tested it. A pull request that touches behaviour a test cannot see should say what was checked by hand.
- CI must pass. The maintainer reviews every pull request and merges it; there is no self-merge, and no direct pushes to `main`.
- Commit messages: one subject line in the imperative, a body that explains why. Say so in a trailer if an AI tool wrote a substantial part of the change.

## Agent tests

`tests/ai/` holds cases that give a live model the skill and a fixture and check what it writes. They are run by hand, never in CI. If your change affects the skill or the format, run the relevant case and record the outcome on its "Last run" line.

## Style

[`CONVENTIONS.md`](CONVENTIONS.md) has the short list. Prettier and ESLint settle formatting and lint; TypeScript strict mode stays on.
