# Forgemark skill package

A small bundle that lets an AI coding agent read and write Forgemark files without learning the format by hand.

## What this is

Forgemark is a desktop app for collaborative review of Markdown documents and generated HTML reports by humans and AI agents working as peers. Comments live inside the file itself: paired `<!-- fmc:N -->...<!-- /fmc:N -->` markers wrap anchored passages, and a single trailing `<!-- forgemark-comments ... -->` HTML comment holds a YAML list of comment records (id, anchor_text, author, body, replies, suggested edits, floating notes).

Both additions are HTML comments, so the format is the same in a `.md` file and in an `.html` report.

The bundle's centrepiece is a command-line tool. An agent that lists, adds, and answers comments through it never composes YAML or places a marker itself, which is where hand-edited reviews used to break: one malformed record hides every comment in the file, and the file looks fine until a reviewer opens it. The tool is built from the app's own parser and serializer, checks that every write reads back, and writes atomically.

## What's inside

- `SKILL.md` — instructions for the agent: the tool, the workflows, and the format reference. Read this first.
- `scripts/forgemark.mjs` — the tool. One self-contained file; runs on Node 18 or newer with no installation. `node scripts/forgemark.mjs --help`.
- `AGENTS.md` — a thin pointer for tools that read `AGENTS.md` but not `SKILL.md`.
- `examples/` — three annotated `.md` files of varying complexity. They are all valid Forgemark documents that round-trip through the parser.
- `README.md` — this file.

## How to install

The Forgemark app ships two artifacts that contain identical bytes:

- `forgemark-skill.skill` — for Claude Code's skill mechanism.
- `forgemark-skill.zip` — for Codex CLI and any tool that wants a standard zip.

Both files are produced from a single zip operation; they differ only in extension. Pick the one your AI tool expects:

- **From the app:** Settings → AI agents installs and updates the skill for Claude Code, Codex, the Claude desktop app, and the shared `~/.agents/skills` folder, and says when an installed copy is behind.
- **Claude Code:** unzip the `.skill` to `~/.claude/skills/forgemark/`. The agent loads `SKILL.md` automatically when relevant and runs the tool from the skill directory.
- **Codex CLI and app:** extract the `.zip` to `~/.codex/skills/forgemark/` (user-global) or `.codex/skills/forgemark/` in a repo.
- **Claude app and claude.ai:** upload the `.skill` under Settings → Capabilities → Skills.
- **Anything else:** extract the `.zip` to `~/.agents/skills/forgemark/`, or feed `SKILL.md` to your agent as system context, and make sure it can run `node`.

`forgemark-skill.json` names the Forgemark version the skill shipped with and a hash of its files; the app reads it to tell an installed copy's state. Leave it in place.

The tool can also be used by a person, from a terminal, for the same operations — `forgemark lint` in particular is a quick check that a file will open cleanly.

## Versioning

The skill is bundled with a specific Forgemark app version, and the tool reports it with `--version`. If the file format evolves, redownload the skill from the new app build — older tools may not know about new fields.
