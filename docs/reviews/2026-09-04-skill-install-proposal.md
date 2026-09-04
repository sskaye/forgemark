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

**Windows and Linux.** The same dot-folders, under the user's home directory, on every platform: none of the tools uses `%APPDATA%` or the XDG directories for skills.

| Tool | Windows | Linux |
| --- | --- | --- |
| Claude Code | `%USERPROFILE%\.claude\skills\` | `~/.claude/skills/` |
| Codex | `%USERPROFILE%\.codex\skills\` | `~/.codex/skills/` |
| Shared | `%USERPROFILE%\.agents\skills\` | `~/.agents/skills/` |

Tauri's `homeDir()` gives the right root on each, so one table entry per tool serves all three platforms. Two overrides exist and the app cannot see either: Claude Code moves its whole folder with `CLAUDE_CONFIG_DIR`, and Codex with `CODEX_HOME`. Both are shell environment variables, and a desktop app launched from the Dock, the Start menu, or a Linux launcher does not inherit the shell's environment. So the app installs to the defaults, and the row for a tool whose default folder is missing offers "Choose folder…" beside Install, for the few people who moved it. The Claude desktop app exists on macOS and Windows only, so the Send to Claude row does not appear on Linux; whether the Windows build registers `.skill` the way the Mac build does is checked when the feature is built.

**Where the app hands off instead.** Claude (chat) in the desktop app and [claude.ai](http://claude.ai) keep skills per account, uploaded through Settings → Capabilities → Skills; there is no folder to write to. But the Claude desktop app registers `.skill` as a document type (its `Info.plist` lists the extension), which is why double-clicking one opens Claude with an offer to install. Forgemark can do exactly what the double-click does: write the bundled `.skill` to its own data folder and ask the system to open that file with Claude. The opener plugin the app already uses takes an application name, so the file goes to Claude even if some other app has claimed the extension. Claude then shows its own install prompt, and the user confirms there. The Code tab of the same desktop app is covered separately, through `~/.claude/skills`.

**Where nothing is possible.** ChatGPT desktop has no skill mechanism; the OpenAI side of this is Codex, which is covered. The download button stays for it and for anyone installing somewhere else.

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
| Not installed | the folder is absent | ○ Not installed · **Install** |
| Current | the tree hash matches the shipped skill | <!-- fmc:1 -->✓ Up to date<!-- /fmc:1 --> |
| Out of date | a manifest is present and the hash differs | <!-- fmc:2 -->↑ 1.4.0 → 1.7.0 · **Update**<!-- /fmc:2 --> |
| Not ours | no manifest, or files the skill never shipped | ! Unrecognized folder · **Replace…**, with a confirmation |

Each state is a glyph and a word or two, the way extension lists and package managers show it: the glyph is also spelled out, so the state never rests on colour alone, and the versions carry the message while the button carries the verb. The last state is what protects a user who edited the skill by hand: the app never silently overwrites a folder it cannot account for.

## The user experience

**Settings → AI agents** replaces the two download buttons with one row per tool the app can reach:

```
AI agents

Forgemark ships a skill that teaches an agent to read and answer review
comments with the app's own tool. Install it where your agents look.

  Claude Code        ↑ 1.4.0 → 1.7.0                  [ Update ]
  Codex              ○ Not installed                  [ Install ]
  Claude app         ↑ Sent 1.4.0 · 12 Aug            [ Send to Claude ]
  Other tools        ○ Not installed  ~/.agents/skills  [ Install ]

  Somewhere else, or claude.ai in a browser:      [ Save skill file… ]
```

- A row appears only when the tool is on this machine (`~/.claude` or `~/.codex` exists). "Other tools" always shows, since `~/.agents` is created by whichever tool uses it first and the user may want it ahead of time; it is the one row that is off by default.
- Install and Update are the same action: write the skill to a fresh folder beside the target, swap it into place, remove the old one. Done in under a second; the row then reads "Installed 1.7.0 · up to date" and, for Claude Code, "New sessions pick it up; restart any that are open."
- Replace asks first, in the app's existing confirm dialog, and names the folder.
- Send to Claude opens the bundled `.skill` in the Claude desktop app, which asks to install it, the same as a double-click on the file. The app cannot see the account's skills, so the row cannot say "up to date"; it says which version was last sent and when (remembered locally), and "this app ships" a newer one after an update. The row appears when the Claude app is installed (`/Applications/Claude.app` on macOS, the equivalent on Windows).
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
- Hand-off to Claude: write `forgemark-skill.skill` to the app data folder (`appDataDir()`), then `openPath(file, "Claude")` from the opener plugin, which runs `open -a Claude` on macOS and the registered handler on Windows. Record the version sent in localStorage. If Claude is not found, the button falls back to the save dialog.
- `SettingsModal.tsx`: the rows, driven by a small reducer (idle, checking, installing, done, error), with the existing button and error styles. The download button becomes the secondary "Save skill file…".
- Capability file: `fs:allow-mkdir`, `fs:allow-read-dir`, `core:path:default` (for `homeDir()`); the scope is already `**`.
- `AppShell`: the once-per-version footer line, keyed in localStorage by app version.
- README and the skill's own README: the install section becomes "open Settings → AI agents", with the manual paths kept for other tools, and the Codex path corrected to `~/.codex/skills`.

**Tests.** Unit: the tree hash agrees between the build script and the app (same file order, same separator); each of the four states from a fake folder; install swaps and removes, and leaves the old folder in place when a write fails. Integration: rows appear only for detected tools; Install → "up to date"; Replace asks first; Send to Claude writes the file and opens it with Claude, and records the version; the footer line shows once and opens Settings. Browser: none needed, nothing here depends on layout. Manual: this machine, where both installed copies are stale, is the test bed; after the update, `/forgemark` in a new Claude Code session should describe the CLI.

**Effort.** About a day: the manifest and hash are an hour, the service and its tests half a day, the Settings rows and footer the rest.

## Decisions

Reviewed 2026-09-04; each answered in the comment on it.

1. <!-- fmc:3 -->Ship the "Other tools" (`~/.agents/skills`) row, or only Claude Code and Codex for now? I lean to shipping it, off by default, since it costs one table entry.<!-- /fmc:3 --> **Decided: ship it.**
2. <!-- fmc:4 -->The launch-time footer line: keep it, or check only when Settings opens? I lean to keeping it; without it nobody learns their copy is stale until they happen to open Settings.<!-- /fmc:4 --> **Decided: keep it.**
3. <!-- fmc:5 -->Version the skill with the app (proposed) or give it its own number? With the app is simpler and true: the two are released together.<!-- /fmc:5 --> **Decided: with the app.**

Sources: [OpenAI, Build skills](https://developers.openai.com/codex/skills) · [GitHub Docs, About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) · [Anthropic Help Center, Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude) · [Claude Code docs, the .claude directory](https://code.claude.com/docs/en/claude-directory) · [Codex config locations](https://inventivehq.com/knowledge-base/openai/where-configuration-files-are-stored)

<!-- forgemark-comments
- id: 1
  anchor_text: "\"Installed, up to date\""
  context_before: "stalled the folder is absent \"Not installed\" · Install Current the tree hash matches the shipped skill "
  context_after: " Out of date a manifest is present and the hash differs \"Installed 1.4.0, this app ships 1.7.0\" · Update"
  author: "Steven Kaye"
  timestamp: "2026-09-04T14:23:51.609Z"
  resolved: true
  body: "See if you can make this shorter/clearer. Check best practices, but something like a check with a single word."
  replies:
    - author: Claude
      timestamp: 2026-09-04T14:27:25Z
      body: |
        Done: the four states now read as a glyph plus a word or two (✓ Up to date, ↑ 1.4.0 → 1.7.0, ○ Not installed, ! Unrecognized folder), following the pattern extension lists and package managers use: a mark that is also spelled out, so it never rests on colour alone.
- id: 2
  anchor_text: "\"Installed 1.4.0, this app ships 1.7.0\" · Update"
  context_before: " matches the shipped skill \"Installed, up to date\" Out of date a manifest is present and the hash differs "
  context_after: " Not ours no manifest, or files the skill never shipped \"A folder is there that Forgemark didn't write\" · Rep"
  author: "Steven Kaye"
  timestamp: "2026-09-04T14:24:18.200Z"
  resolved: true
  body: "See if you can make this shorter/clearer. Check best practices, but something like a small symbol and 1 to a few words."
  replies:
    - author: Claude
      timestamp: 2026-09-04T14:27:25Z
      body: |
        Done: the out-of-date row is now ↑ 1.4.0 → 1.7.0 with the Update button; the versions carry the message and the button carries the verb.
- id: 3
  anchor_text: "Ship the \"Other tools\" (~/.agents/skills) row, or only Claude Code and Codex for now? I lean to shipping it, off by default, since it costs one table entry."
  context_before: "nd hash are an hour, the service and its tests half a day, the Settings rows and footer the rest. Decisions for you "
  context_after: " The launch-time footer line: keep it, or check only when Settings opens? I lean to keeping it; without it nobody lea"
  author: "Steven Kaye"
  timestamp: "2026-09-04T14:25:29.167Z"
  resolved: true
  body: "Yes, include other tools."
  replies:
    - author: Claude
      timestamp: 2026-09-04T14:27:25Z
      body: |
        Recorded as decided: the Other tools row ships.
- id: 4
  anchor_text: "The launch-time footer line: keep it, or check only when Settings opens? I lean to keeping it; without it nobody learns their copy is stale until they happen to open Settings."
  context_before: ") row, or only Claude Code and Codex for now? I lean to shipping it, off by default, since it costs one table entry. "
  context_after: " Version the skill with the app (proposed) or give it its own number? With the app is simpler and true: the two are r"
  author: "Steven Kaye"
  timestamp: "2026-09-04T14:25:40.766Z"
  resolved: true
  body: "Keep, I like this."
  replies:
    - author: Claude
      timestamp: 2026-09-04T14:27:25Z
      body: |
        Recorded as decided: the launch-time footer line stays.
- id: 5
  anchor_text: "Version the skill with the app (proposed) or give it its own number? With the app is simpler and true: the two are released together."
  context_before: "ttings opens? I lean to keeping it; without it nobody learns their copy is stale until they happen to open Settings. "
  context_after: " Sources: OpenAI, Build skills · GitHub Docs, About agent skills · Anthropic Help Center, Use skills in Claude"
  author: "Steven Kaye"
  timestamp: "2026-09-04T14:25:51.413Z"
  resolved: true
  body: "With the app."
  replies:
    - author: Claude
      timestamp: 2026-09-04T14:27:25Z
      body: |
        Recorded as decided: the skill takes the app's version.
-->
