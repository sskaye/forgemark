# Forgemark

A desktop application for collaborative review of Markdown documents and generated HTML reports — by humans **and** AI agents working as peers. Comments, threaded replies, and suggested edits all live inside the file itself, so an AI agent reading the raw file sees the full review context with no special tooling.

> **Status:** v1.3.0 — see [CHANGELOG](CHANGELOG.md) for what shipped.

## What it is

- **For humans:** a quiet, native macOS / Windows app that feels like Word commenting — select text, type a note, see threads in a sidebar, suggest edits. Open several documents at once in tabs; they reopen where you left them.
- **For generated reports:** open an `.html` file and review it the same way. The report renders exactly as its author designed it — its own CSS, its own charts — and you can comment on a passage or on a whole figure. See [HTML reports](#html-reports).
- **For AI agents:** the same comments are plain markdown. Read existing comments, add new ones, address them — all by editing the file. The bundled [skill package](#ai-agents) teaches Claude / Codex / any other capable LLM the format in one read.
- **Not** a Google Docs replacement, not a real-time co-editor, not a git client. Specifically a review tool.

For contributors and agents, the current code map is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Install

Pre-built binaries: see the [Releases page](https://github.com/sskaye/forgemark/releases) for a signed, notarized `.dmg` (macOS 11+) and an `.msi` / `.exe` (Windows 10+). On first launch you get a welcome screen — pick a name and click **Open sample →** to land in a pre-annotated review document.

### Installing on Windows (unsigned)

The Windows installers are **not code-signed** yet, so Windows SmartScreen will warn before it runs. Nothing is blocked — to install:

1. If your browser flags the download, choose **Keep**.
2. Run the `.msi` (or `-setup.exe`). On the blue **"Windows protected your PC"** screen, click **More info**, then **Run anyway**.
3. The UAC prompt will show **Publisher: Unknown** — that's expected for an unsigned build.

(macOS builds are signed + notarized, so they open with no prompt.)

To build from source, see [Build](#build).

## File format

A Forgemark file is plain markdown plus two small additions:

```markdown
Across <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 -->,
the strongest predictor of week-two retention was completing a real piece of work.

<!-- forgemark-comments
- id: 1
  anchor_text: "fourteen interviews with new enterprise customers"
  context_before: "Across"
  context_after: ", the strongest predictor"
  author: Claude
  timestamp: 2026-05-07T09:14:00Z
  resolved: false
  body: |
    Worth noting the sample composition.
-->
```

Inline `<!-- fmc:N -->...<!-- /fmc:N -->` markers wrap commented passages; a single trailing HTML comment holds a YAML list of records (id, anchor_text, author, body, replies, suggested edits, floating notes). The file round-trips byte-equivalent through the parser; comments survive `git diff` because they're plain text.

The canonical spec lives in [`assets/forgemark-skill/SKILL.md`](assets/forgemark-skill/SKILL.md).

## HTML reports

`<!-- fmc:N -->` is already valid HTML, and so is the trailing comments block, so the storage format is identical in an `.html` file — no translation, no second format to learn.

What differs is what you can do with the document:

|                                      | Markdown | HTML report         |
| ------------------------------------ | -------- | ------------------- |
| Comment, reply, resolve              | yes      | yes                 |
| Suggest an edit                      | yes      | on plain prose only |
| Accept / reject a suggestion         | yes      | yes                 |
| Comment on a figure, chart, or table | —        | yes                 |
| Edit the prose                       | yes      | no                  |
| Find (⌘F)                            | yes      | Source view only    |

**Reports are review-only by design.** Editing one would mean modelling the document, and any model that round-trips through an editor destroys the `<style>` block, the inline `<svg>`, and every unrecognised attribute a generated report is made of. So Forgemark renders the file verbatim in a sandboxed frame and only ever splices markers into the source at exact byte offsets — the file you save differs from the one you opened by the comments you added, and nothing else.

**Scripts inside a report never run.** A chart drawn in JavaScript renders empty; static and inline-SVG charts are unaffected.

**Rebuilding a report keeps the review.** Reports are usually regenerated rather than edited, which drops every anchor. Forgemark puts back the ones it is sure about in one click and asks about anything ambiguous. Comments on a figure record its `id`, so they reattach exactly even if the caption was renumbered — worth telling your agent to keep ids stable, which the bundled skill already does.

## AI agents

The Settings → AI Participation panel exposes two download buttons:

- **Download for Claude (`.skill`)**
- **Download for Codex (`.zip`)**

Both files contain identical content; the extension is what your AI tool expects. With the skill installed, asking your agent to "add a comment", "address that review note", or "suggest a tighter wording" produces well-formed Forgemark output that the app reads back without complaint.

### Install in Claude Code (CLI)

```bash
unzip ~/Downloads/forgemark-skill.skill -d ~/.claude/skills/forgemark
```

User-global, available in every project. Restart any running Claude Code sessions; new sessions auto-discover the skill on startup. To verify, type `/` in Claude Code — `/forgemark` should appear in the autocomplete.

For project-local install (commit alongside the repo so teammates pick it up automatically), extract to `<repo>/.claude/skills/forgemark/` instead. Project-local takes precedence over user-global if both exist.

### Install in Codex CLI

Extract the `.zip` to `~/.agents/skills/forgemark/` (user-global) or `.agents/skills/forgemark/` in a repo (project-local). Codex picks it up on the next run.

### Other tools

The skill is a regular zip. Extract it and feed `SKILL.md` to your agent as system context if your tool doesn't have a skill mechanism.

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
npm test                  # Vitest unit + integration
npm run test:e2e          # Playwright E2E (against the Vite dev surface)
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
npm run format            # Prettier write
npm run build             # production Tauri bundle
npm run build:skill       # rebuild the .skill / .zip artefacts
npm run build:icons       # regenerate the icon stack from forgemark-icon.svg
npm run verify-ai-output  # validate a captured AI output against the format
```

For release engineering (signing, notarization, distribution), see [`RELEASING.md`](RELEASING.md).

## AI testing

AI-agent tests are **never run in CI** — they call live LLMs and are stochastic. Run them locally:

- **Primary path (recommended):** open Claude Code, invoke a sub-agent with a fixture from `tests/ai/fixtures/`, the skill content at `assets/forgemark-skill/SKILL.md`, and a prompt from `tests/ai/cases/`. Capture the result in the PR description.
- **Optional SDK harness:** `RUN_AI_TESTS=1 npm run test:ai` (requires `ANTHROPIC_API_KEY`).

The prompt fixtures and expected behaviors live under `tests/ai/`.

## Repo layout

```
src/                React + TypeScript UI
src-tauri/          Tauri shell (Rust)
tests/              Unit, integration, E2E, perf, AI-agent tests
docs/               Current architecture notes and retained token source
assets/             Skill package, sample documents, app icon
scripts/            Build helpers (skill packaging, icon generation, verifier)
.github/workflows/  CI (no AI tests)
```

## Contributing

See [`CONVENTIONS.md`](CONVENTIONS.md) for branch naming, commit style, code style, and the testing layout.

## License

MIT — see [`LICENSE`](LICENSE).
