# Forgemark skill package

A small bundle that teaches an AI coding agent how to read and write Forgemark files.

## What this is

Forgemark is a desktop app for collaborative review of markdown documents by humans and AI agents working as peers. Comments live inside the `.md` file itself: paired `<!-- fmc:N -->...<!-- /fmc:N -->` markers wrap anchored passages, and a single trailing `<!-- forgemark-comments ... -->` HTML comment holds a YAML list of comment records (id, anchor_text, author, body, replies, suggested edits, floating notes).

If you don't ship this skill to your AI tool, the agent has to re-derive the format from sample files — fine for reading, error-prone for writing.

## What's inside

- `SKILL.md` — the canonical format spec. Single file, ~9 KB. Read this first.
- `AGENTS.md` — a thin pointer for tools that read `AGENTS.md` but not `SKILL.md`.
- `examples/` — three annotated `.md` files of varying complexity. They are all valid Forgemark documents that round-trip through the parser.
- `README.md` — this file.

## How to install

The Forgemark app ships two artifacts that contain identical bytes:

- `forgemark-skill.skill` — for Claude Code's skill mechanism.
- `forgemark-skill.zip` — for Codex CLI and any tool that wants a standard zip.

Both files are produced from a single zip operation; they differ only in extension. Pick the one your AI tool expects:

- **Claude Code:** install the `.skill` via the standard skill installation flow. The agent will load `SKILL.md` automatically when relevant.
- **Codex CLI:** extract the `.zip` to `.agents/skills/forgemark/` (repo-local) or `~/.agents/skills/forgemark/` (user-global). Codex picks up the skill on the next run.
- **Anything else:** extract the `.zip` and feed `SKILL.md` to your agent as system context.

## Versioning

The skill is bundled with a specific Forgemark app version. If the file format evolves, redownload the skill from the new app build — older skills may not know about new fields.
