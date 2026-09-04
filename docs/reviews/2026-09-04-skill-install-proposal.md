# Proposal: install the agent skill from the app

Date: 2026-09-04. Branch: `feature/skill-install`. Status: for review.

## The problem

Getting the skill into an agent today is three steps by hand: download the `.skill` or `.zip` from Settings, extract it into the right hidden folder, and remember to do it again after every Forgemark update. Nothing tells the user when their copy is behind. On this machine both installed copies (`~/.claude/skills/forgemark` and `~/.codex/skills/forgemark`) predate the command-line tool: an agent using them today would still be composing YAML by hand, and the app gives no sign of it.

## Is it feasible?

Yes, for the tools that read skills from the filesystem, and that is most of them.

**Where skills live.** Since Anthropic published Agent Skills as an open standard (December 2025), a skill is one folder with a `SKILL.md`, and each tool reads a known place under the home directory:

| Tool | User-level folder | Notes |
| --- | --- | --- |
| Claude Code (CLI, the Code tab in the Claude desktop app, IDE extensions) | `~/.claude/skills/<name>/` | Project-level: `<repo>/.claude/skills/`. New sessions pick a skill up on start. |
| Codex (CLI and the Codex desktop app) | `~/.codex/skills/<name>/` | Project-level: `.codex/skills/` and `.agents/skills/`. Also symlink-aware. |
| The shared location | `~/.agents/skills/<name>/` | Read by Codex, Cursor, Gemini CLI, GitHub Copilot, and others that adopted the standard. |

Our README tells Codex users to extract into `~/.agents/skills`. Codex does read that, but its own folder is `~/.codex/skills`, and the app should install there so the Codex desktop app sees it too.

**Where the app cannot install.** Two of the tools you named have no filesystem skill folder:

- **Claude (chat) in the desktop app and claude.ai.** Skills are uploaded per account through Settings → Capabilities → Skills, as a zip or a folder, then switched on. There is no local path to write to, and no API from a desktop app. The Code tab of the same desktop app *is* covered, through `~/.claude/skills`.
- **ChatGPT desktop.** No skill mechanism at all; the OpenAI side of this is Codex, which is covered.

For those two the download button stays, with the instructions in one sentence beside it.

**What the app already has.** The filesystem scope is `**`, so `~/.claude/skills` and `~/.codex/skills` are already writable; the missing permissions are `mkdir`, `read-dir`, `copy`, and the home-directory lookup, each one line in the capability file. The skill's source tree ships in the app as the `.skill` bundle (via Vite); the same tree can be bundled as raw files, so no unzipping at runtime. Every write goes through the existing plugin, so the fake Tauri in the test harness covers it and the behaviour is testable under jsdom.

## Versioning, which does not exist yet

There is no way today to tell one build of the skill from another: the `.skill` file is a deterministic zip, but the extracted folder carries no version. The proposal adds one file to the skill:

```
forgemark-skill.json
{ "version": "1.7.0", "tree": "sha256 of every file, in path order" }
```

Written by `build-skill.mjs`, versioned with the app (the skill and the app that ships it are one release; `scripts/set-version.mjs` already stamps both `package.json` and `tauri.conf.json`). Agent tools ignore files they do not know, so the manifest is harmless in place.

The app judges an installed copy by hashing its files the same way, not by reading the manifest alone. That gives four states:

| State | Meaning | Shown as |
| --- | --- | --- |
| Not installed | the folder is absent | "Not installed" · **Install** |
| Current | the tree hash matches the shipped skill | "Installed, up to date" |
| Out of date | a manifest is present and the hash differs | "Installed 1.4.0, this app ships 1.7.0" · **Update** |
| Not ours | no manifest, or files the skill never shipped | "A folder is there that Forgemark didn't write" · **Replace…**, with a confirmation |

The last state is what protects a user who edited the skill by hand: the app never silently overwrites a folder it cannot account for.

## The user experience

**Settings → AI agents** replaces the two download buttons with one row per tool the app can reach:

```
AI agents

Forgemark ships a skill that teaches an agent to read and answer review
comments with the app's own tool. Install it where your agents look.

  Claude Code        Installed 1.4.0 · this app ships 1.7.0     [ Update ]
  Codex              Not installed                              [ Install ]
  Other tools        Not installed  (~/.agents/skills)          [ Install ]

  Claude desktop and claude.ai take the skill as an upload:
  Settings → Capabilities → Skills.            [ Save skill file… ]
```

- A row appears only when the tool is on this machine (`~/.claude` or `~/.codex` exists). "Other tools" always shows, since `~/.agents` is created by whichever tool uses it first and the user may want it ahead of time; it is the one row that is off by default.
- Install and Update are the same action: write the skill to a fresh folder beside the target, swap it into place, remove the old one. Done in under a second; the row then reads "Installed 1.7.0 · up to date" and, for Claude Code, "New sessions pick it up; restart any that are open."
- Replace asks first, in the app's existing confirm dialog, and names the folder.
- Save skill file… is today's download, kept for the upload-only tools and for anyone installing somewhere else.

**Telling the user without nagging.** The check runs when Settings opens and once at launch. At launch, only two things can happen:

- If a copy is installed and out of date, the sidebar footer shows one line, "Agent skill out of date · Update", once per app version. Clicking it opens Settings at that row. Dismissing it hides it until the next Forgemark update.
- Nothing is ever installed, updated, or written at launch on its own. A skill folder is the agent's configuration, and changing it behind the user's back is the wrong side of the line, even when the change is an upgrade.

No modal, no first-run wizard. A user who never opens Settings sees at most one line in the footer.

**Help menu.** "Install AI skill…" opens Settings at the section, so the feature is findable without knowing it lives under Settings.

**Project-level installs** (`<repo>/.claude/skills`, checked in for a team) are not in this proposal. The document's folder is not reliably the repository, and a checked-in skill is a team decision made in a pull request, not from an app. The saved skill file covers it.

## How it would be built

- `scripts/build-skill.mjs` writes `forgemark-skill.json` into `assets/forgemark-skill/` before zipping (the tree hash excludes the manifest itself). The existing `skill-bundle.test.ts` gains a check that the manifest's version equals the app's.
- `src/services/skillInstall.ts`: the skill's files come in through `import.meta.glob("../../assets/forgemark-skill/**", { query: "?raw", eager: true })`, so the installed copy is the source tree byte for byte, and the download path keeps using the zip. `targets()` lists the rows (name, folder, detection folder, restart note); `status(target)` hashes the installed tree; `install(target)` writes to `<folder>.installing`, renames the old folder aside, renames the new one in, removes the old, and reads the result back before reporting success, the same discipline the CLI uses for a file.
- `SettingsModal.tsx`: the rows, driven by a small reducer (idle, checking, installing, done, error), with the existing button and error styles. The download button becomes the secondary "Save skill file…".
- Capability file: `fs:allow-mkdir`, `fs:allow-read-dir`, `core:path:default` (for `homeDir()`); the scope is already `**`.
- `AppShell`: the once-per-version footer line, keyed in localStorage by app version.
- README and the skill's own README: the install section becomes "open Settings → AI agents", with the manual paths kept for other tools, and the Codex path corrected to `~/.codex/skills`.

**Tests.** Unit: the tree hash agrees between the build script and the app (same file order, same separator); each of the four states from a fake folder; install swaps and removes, and leaves the old folder in place when a write fails. Integration: rows appear only for detected tools; Install → "up to date"; Replace asks first; the footer line shows once and opens Settings. Browser: none needed, nothing here depends on layout. Manual: this machine, where both installed copies are stale, is the test bed; after the update, `/forgemark` in a new Claude Code session should describe the CLI.

**Effort.** About a day: the manifest and hash are an hour, the service and its tests half a day, the Settings rows and footer the rest.

## Decisions for you

1. Ship the "Other tools" (`~/.agents/skills`) row, or only Claude Code and Codex for now? I lean to shipping it, off by default, since it costs one table entry.
2. The launch-time footer line: keep it, or check only when Settings opens? I lean to keeping it; without it nobody learns their copy is stale until they happen to open Settings.
3. Version the skill with the app (proposed) or give it its own number? With the app is simpler and true: the two are released together.

Sources: [OpenAI, Build skills](https://developers.openai.com/codex/skills) · [GitHub Docs, About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) · [Anthropic Help Center, Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
