## What changed, and why

<!-- If this fixes an issue, say "Fixes #123" so it closes on merge. -->

## How it was tested

<!-- Which tests were added or changed. What was checked by hand, if a test could not see it. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm run format:check && npm test` pass
- [ ] `npm run test:e2e` passes, if what the app shows changed
- [ ] Rust checks pass, if `src-tauri/` changed
- [ ] `npm run build:skill` run and bundles committed, if `src/format/` or `assets/forgemark-skill/` changed
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`, if a user would notice
