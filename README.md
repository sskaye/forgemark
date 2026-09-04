# Forgemark

A desktop app for reviewing Markdown documents and generated HTML reports, where the reviewers are people and AI agents. Comments, replies, and suggested edits live inside the file as plain text, so an agent reading the file sees the whole review and can answer it.

## What it does

- **Review in the app.** Select text and a Comment / Suggest edit bar appears. Threads show in a sidebar. Several documents open in tabs and reopen where you left them.
- **Review generated reports.** Open an `.html` file and review it the same way. The report renders as its author built it, scripts included, and you can comment on a passage or on a whole figure.
- **Let agents take part.** The bundled skill gives Claude Code, Codex, and other agents a command-line tool that reads, adds, and answers comments without touching the markup by hand. Settings installs it where each tool looks.
- **Keep the file yours.** The comments are HTML comments and a YAML block at the end of the file. Everything else is left as it was, byte for byte. `git diff` shows the review as text.

It is a review tool, not a shared editor: no accounts, no server, no real-time collaboration.

## Install

Download from the [Releases page](https://github.com/sskaye/forgemark/releases): a signed and notarized `.dmg` for macOS 11 and later, and an `.msi` or `.exe` for Windows 10 and later. On first launch, pick a name and click Open sample to see a reviewed document.

**Windows installers are not code-signed.** SmartScreen warns before running one. To install: keep the download if the browser flags it, run the installer, click More info on the "Windows protected your PC" screen, then Run anyway. The UAC prompt shows Publisher: Unknown. macOS builds are signed and open without a prompt.

To build from source, see [Build](#build).

## File format

A Forgemark file is the document plus two additions: marker pairs around the commented passages, and one HTML comment at the end holding the comment records as YAML.

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

Records carry the id, the anchored text, the author, the body, replies, suggested edits, and floating notes. The parser reads a file back to the same bytes it wrote. The full reference is in [`assets/forgemark-skill/SKILL.md`](assets/forgemark-skill/SKILL.md).

Beyond CommonMark, the rendered view shows what GitHub shows: tables, task lists, footnotes, alerts, math, Mermaid diagrams, syntax-highlighted code, and inline HTML. It also shows Obsidian callouts, wikilinks, and image embeds. Editing a paragraph rewrites only that paragraph in the file, and keeps the syntax it was written in.

## HTML reports

The markers and the comments block are valid HTML, so a report uses the same format with no translation. What you can do differs:

|                                      | Markdown | HTML report                  |
| ------------------------------------ | -------- | ---------------------------- |
| Comment, reply, resolve              | yes      | yes                          |
| Suggest an edit                      | yes      | on plain prose only          |
| Accept or reject a suggestion        | yes      | yes                          |
| Comment on a figure, chart, or table | no       | yes, from a button beside it |
| Edit the text                        | yes      | in Source view               |
| Find and replace                     | yes      | in Source view               |

A report renders in a frame of its own, on a separate origin, where its scripts run as they would in a browser. Tabs, charts drawn in JavaScript, and controls all work. The app never edits a report through a document model, which would drop the styles, SVG, and attributes a generated report is made of; it splices markers into the source at exact byte offsets, and Source view edits the text directly.

A comment on text that a script produced anchors the nearest enclosing element with an `id`, and keeps the passage as its text. Without such an element, it becomes a floating note that quotes the text.

Reports are usually regenerated rather than edited, which drops every anchor. On reload, Forgemark puts back the anchors it is sure about and asks about the rest. A comment on a figure records the figure's `id`, so it reattaches exactly when the id survives a rebuild. The skill tells agents to keep ids stable.

## AI agents

Settings, then AI agents, installs the skill where each tool looks and says when an installed copy is behind:

- **Claude Code** at `~/.claude/skills/forgemark`, **Codex** at `~/.codex/skills/forgemark`, and **Other tools** at `~/.agents/skills/forgemark`, the shared folder read by Cursor, Gemini CLI, GitHub Copilot, and others. Each row shows Not installed, Up to date, or the installed and shipped versions, with an Install or Update button. A folder Forgemark did not write is replaced only after asking.
- **Claude app** hands the `.skill` file to the Claude desktop app, which asks to install it for your account.
- **Save skill file** writes the bundle anywhere, for claude.ai in a browser or a tool not listed.

Nothing is installed without a click. When an update ships a newer skill than the one installed, the sidebar shows a one-line notice, once per version.

With the skill installed, asking an agent to add a comment, address a review note, or suggest a wording produces a file the app reads back without complaint. The skill's tool is `scripts/forgemark.mjs`, one file that runs on Node 18 or later with nothing to install:

```bash
forgemark list report.md
forgemark show report.md 3
forgemark comment report.md --anchor "the evening and the small hours" --body "Too strong." --author Claude
forgemark reply report.md 3 --body "Softened in section 2." --author Claude
forgemark lint report.md
```

Every write is parsed back before the file is replaced, and the replacement is atomic, so the tool cannot leave a file the app cannot read. `lint` reports what the app would refuse and what a reviewer would want to know about, such as an orphaned comment or a drifted anchor description. The tool works for people too: `npm run cli -- lint file.md` from a checkout, or `node forgemark.mjs` from an installed skill.

### Installing by hand

The saved file is a zip holding one `forgemark` folder. Tools that follow the Agent Skills standard read such a folder from the home directory, the same paths on macOS, Windows (`%USERPROFILE%`), and Linux:

| Tool                                           | Folder                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Claude Code                                    | `~/.claude/skills/forgemark/` (project-local: `<repo>/.claude/skills/forgemark/`)   |
| Codex CLI and app                              | `~/.codex/skills/forgemark/` (project-local: `.codex/skills/` or `.agents/skills/`) |
| Cursor, Gemini CLI, GitHub Copilot, and others | `~/.agents/skills/forgemark/`                                                       |
| Claude app and claude.ai                       | Settings, Capabilities, Skills: upload the `.skill` or `.zip`                       |

```bash
unzip ~/Downloads/forgemark-skill.skill -d ~/.claude/skills
```

New Claude Code sessions pick the skill up on start; `/forgemark` appears in the slash-command list. A tool with no skill mechanism can be given `SKILL.md` as system context.

## Build

Requirements:

- Node.js 20 or later and npm 11 or later
- Rust, stable, via [rustup](https://rustup.rs/)
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ Build Tools

```bash
git clone https://github.com/sskaye/forgemark.git
cd forgemark
npm install
npm run dev
```

Scripts:

```bash
npm test                  # unit and integration tests (Vitest)
npm run test:e2e          # browser tests (Playwright, against the Vite dev server)
npm run test:perf         # timing assertions, skipped by the default run
npm run lint              # ESLint
npm run typecheck         # tsc
npm run format            # Prettier
npm run build             # production Tauri bundle
npm run build:skill       # rebuild the CLI and the .skill and .zip bundles
npm run build:icons       # regenerate the icon set from assets/forgemark-icon.svg
npm run cli -- <args>     # run the CLI from source
```

Agent tests under `tests/ai/` call a live model and are run by hand, never in CI: give a sub-agent a fixture, the skill, and a case file, and record the outcome on the case's "Last run" line.

Releases are built with `npm run release`; see [`RELEASING.md`](RELEASING.md).

## Repository layout

```
src/                React and TypeScript app
cli/                the forgemark command-line tool, built from src/format
src-tauri/          Tauri shell (Rust)
tests/              unit, integration, browser, perf, and agent tests
assets/             the skill package, sample documents, the app icon
docs/               architecture notes, example files, design reviews and plans
scripts/            build helpers: CLI bundle, skill packaging, icons, release
.github/workflows/  CI and the Windows release build
```

## Contributing

Contributions are welcome through pull requests; see [`CONTRIBUTING.md`](CONTRIBUTING.md). Every change to `main` is reviewed by the maintainer. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the code map, and [`CONVENTIONS.md`](CONVENTIONS.md) covers style and testing.

## License

MIT. See [`LICENSE`](LICENSE).
