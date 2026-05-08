# Forgemark

A desktop application for collaborative review of markdown documents — by humans **and** AI agents working as peers. Comments, threaded replies, and suggested edits all live inside the markdown file itself, so an AI agent reading the raw file sees the full review context with no special tooling.

> **Status:** v1 in active development. Currently shipping Phase 0 (project bootstrap). See `docs/implementation-plan.md` for the phased build plan.

## What it is

- **For humans:** a quiet, native macOS / Windows app that feels like Word commenting — select text, type a note, see threads in a sidebar, suggest edits.
- **For AI agents:** the same comments are plain markdown. Read existing comments, add new ones, address them — all by editing the file.
- **Not** a Google Docs replacement, not a real-time co-editor, not a git client. Specifically a review tool.

The full product proposal is at [`docs/markdown-commenter-proposal.md`](docs/markdown-commenter-proposal.md).

## Build

Requires:

- **Node.js 20+** and **npm 11+**
- **Rust** (stable, via [rustup](https://rustup.rs/)) — needed by Tauri
- **macOS:** Xcode Command Line Tools
- **Windows:** Microsoft Visual Studio C++ Build Tools

```bash
git clone https://github.com/sskaye/forgemark.git
cd forgemark
npm install
npm run dev          # opens the Tauri window
```

Other useful scripts:

```bash
npm test             # Vitest unit + integration
npm run test:e2e     # Playwright E2E (against the Vite dev surface)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # Prettier write
npm run build        # production Tauri bundle
```

## AI testing

AI-agent tests are **never run in CI** — they call live LLMs and are stochastic. Run them locally:

- **Primary path (recommended):** open Claude Code, invoke a sub-agent with a fixture from `tests/ai/fixtures/`, the skill content at `assets/forgemark-skill/SKILL.md`, and a prompt from `tests/ai/cases/`. Capture the result in the PR description.
- **Optional SDK harness:** `RUN_AI_TESTS=1 npm run test:ai` (requires `ANTHROPIC_API_KEY`).

See `docs/implementation-plan.md` §2 for the methodology.

## Skill package

The `assets/forgemark-skill/` directory is the canonical Forgemark format spec for AI agents. It works directly with both **Claude** (`.skill` extension on a zip) and **OpenAI Codex CLI** (`.zip` extension on the same zip). The Settings → AI Participation section ships two download buttons that emit byte-identical artefacts with the right extensions.

## Repo layout

```
src/                React + TypeScript UI
src-tauri/          Tauri shell (Rust)
tests/              Unit, integration, E2E, AI-agent tests
docs/               Proposal, design handoff, implementation plan
assets/             Skill package and sample files
.github/workflows/  CI (no AI tests)
```

## Contributing

See [`CONVENTIONS.md`](CONVENTIONS.md) for branch naming, commit style, code style, and the testing layout.

## License

See [`LICENSE`](LICENSE).
