# Markdown Commenter: Proposal for a Human + AI Collaborative Review Tool

## Background and Problem Statement

AI agents increasingly produce reports, analyses, and drafts in markdown format. Markdown is an excellent intermediate representation: it is plain text, version-controllable, AI-native, and renders cleanly across many surfaces. However, the tooling for **collaborative review** of markdown documents is poor compared to what knowledge workers expect from Microsoft Word and Google Docs.

Existing options each fail in at least one critical dimension:

- **GitHub pull requests** support precise line-level commenting and threaded discussion, but the workflow is heavy: branches, commits, PRs, and a UI optimized for code review rather than prose review. PR comments also live in GitHub's database, not in the file itself, so they vanish when the markdown is consumed outside that surface.
- **HackMD, Dropbox Paper, Notion, Google Docs** offer the convenient highlight-and-comment UX users want, but comments live in proprietary sidebars or databases. When the document is exported back to markdown, comments are silently dropped. An AI agent reading the exported file has no idea any review ever happened.
- **CriticMarkup and HTML comments** preserve annotations in plain text that AI agents can parse, but they require the human reviewer to type syntax by hand. There is no editor UX that makes this feel like commenting in Word.
- **Obsidian and VS Code with plugins** get partway there, but the experience is fragmented and oriented toward power users rather than reviewers.

The result is a workflow gap: reviewers either get convenience (Google Docs-style commenting) and lose AI-readability, or they get AI-readability (CriticMarkup, HTML comments) and lose convenience. No tool offers both.

This proposal describes a standalone desktop application that closes this gap.

## Goals

The tool should make commenting on a markdown file feel as natural as commenting in Google Docs, while ensuring that every comment, reply, and suggested edit is preserved in the markdown file itself in a format that AI agents can read and act on without any conversion or extraction step.

A reviewer should be able to open a `.md` file, highlight a passage, type a comment, see the comment in a sidebar alongside other comments, reply to existing threads, resolve threads, and save the file. The saved file should remain a valid markdown document that renders correctly in any markdown viewer, while also containing the full comment history in a structured, parseable form.

## Non-Goals

The tool is not a markdown authoring environment competing with Typora, Obsidian, or iA Writer. Its job is review and commentary, not primary writing. It is not a real-time multi-user collaboration platform like Google Docs; collaboration happens through sequential file exchange (email, Dropbox, git, sending the file back to the agent), where one party at a time annotates and passes the file along. Concurrent independent annotation by multiple parties — where two reviewers each receive the same starting file, annotate in parallel, and then need to combine results — is deferred to Future Work. It is not a git client or a PR review tool.

## Target Users

The tool has two co-primary users: the human reviewer and the AI agent. Both should find the file equally easy to read and to comment on.

The human reviewer is someone who works regularly with AI-produced markdown — technical reviewers, researchers, R&D leads, investors evaluating proposals, and writers using AI for drafts. They interact with the file through the application's GUI.

The AI agent is a peer participant in the review. It reads existing comments and acts on them, and it can also write new comments and replies directly into the file using the same storage format the GUI emits. The format must therefore be simple enough for an AI to produce correctly without bespoke tooling — same schema, same delimiters, same conventions, whether a human or an AI is the author.

## Functional Requirements

### Commenting Experience

The reviewer should be able to select any range of text in the rendered markdown view and open a comment composer with a keyboard shortcut or context menu. A composition box appears in a right-hand sidebar, anchored visually to the highlighted passage. The reviewer types their comment and submits.

Every interaction other than typing the comment text itself must have a discoverable GUI control in addition to any keyboard shortcut. Concretely: a Submit button in the composition box (alongside Cmd+Enter / Ctrl+Enter), Reply / Edit / Resolve / Unresolve / Delete buttons on each comment card, a "Suggest edit" toggle in the composer, Accept and Reject buttons on suggested edits, and a full application menu bar exposing every command. Keyboard shortcuts are an accelerator, never the only path.

An author can edit any comment or reply they originally authored. Editing reopens the body in the composer and updates an `edited_at` timestamp on save (see Storage Format). Edit access is restricted to the original author by name match; the file format does not authenticate identity, so this is a UI convention, not a security boundary.

Deletion, by contrast, is open to any reviewer, not just the original author. Comments that nobody can clean up tend to persist indefinitely, which is worse for a long-lived shared file than the small risk of accidental removal. Delete is therefore available on any comment from the comment-card menu.

Every comment, reply, and suggested edit is attributed to an author. The author name is taken from a single user-set field in preferences (see Preferences below). When an AI agent writes directly into the file, it uses the same `author:` field with whatever name it identifies as ("Claude", "ChatGPT", or similar). There is no privileged distinction between human and AI authors in the schema.

Existing comments appear as cards in the sidebar, sorted by document position. Each card shows the author and timestamp. Clicking a comment scrolls the document to its anchor and highlights the referenced text. Hovering an annotated passage in the document highlights the corresponding sidebar card.

Threads support replies. Each reply is timestamped and attributed. Regular comment threads can be marked resolved, which collapses them in the sidebar but preserves them in the file (suggestion threads behave differently — see below).

Suggested edits are a distinct comment type. The reviewer can highlight text and choose "Suggest edit" to propose a replacement. Suggestions render with strikethrough-and-insertion styling in the sidebar preview, and have explicit Accept and Reject controls. Following the convention used by Google Docs and Microsoft Word, Accept and Reject are terminal: accepting replaces the anchored text with the proposed replacement and removes the suggestion thread from the file; rejecting leaves the original text and likewise removes the thread. Suggestion threads are not retained as resolved threads.

### Storage Format

Comments are stored inside the markdown file itself, in a format that is both human-readable when viewed as plain text and parseable by AI agents and other tools without a custom library. The block always lives at the end of the file; this is a fixed design decision, not a user-configurable option.

Comments come in two structural shapes. **Anchored comments** wrap a passage in the document body with paired inline markers and link back to that passage from a YAML record. **Floating notes** have no inline markers — they live only in the YAML block, with a `floating: true` flag. Floating notes are a steady-state, not a transient recovery state: a comment can begin life floating (e.g., an AI agent leaves a general note that doesn't pin to a passage) or become floating later (the user converts an orphaned anchor to a note rather than reattaching).

Two complementary mechanisms are used:

**Inline anchors** mark the commented passages in the document body using paired open/close markers. The format is `<!-- fmc:1 -->highlighted text<!-- /fmc:1 -->` where `1` is the comment's ID. Each marker is itself an HTML comment, so it is invisible in any rendered markdown view — the file renders identically to the original prose to readers using non-Forgemark viewers. Comment IDs are sequential positive integers (1, 2, 3, …), assigned at creation time, never reused within a file, and chosen to be short and human-readable. New comments take the next ID one greater than the current maximum in the file. Markers should generally wrap whole words or phrases rather than splitting words mid-character; the application's selection UI already enforces this in practice.

**A comments block** at the end of the file holds the structured comment data, as YAML wrapped inside a single HTML comment. The block opens with the sentinel line `<!-- forgemark-comments` and closes with the standard HTML comment terminator `-->`:

```
<!-- forgemark-comments
- id: 1
  anchor_text: "the passage that was selected"
  context_before: "...sentence or so of text immediately before the anchor..."
  context_after: "...sentence or so of text immediately after the anchor..."
  author: Steven
  timestamp: 2026-05-07T14:32:00Z
  resolved: false
  body: |
    This claim needs a citation.
  replies:
    - author: Claude
      timestamp: 2026-05-07T14:35:00Z
      body: |
        Added citation to the appendix in the next revision.
- id: 2
  anchor_text: "an old phrase"
  context_before: "..."
  context_after: "..."
  author: Steven
  timestamp: 2026-05-07T14:40:00Z
  edited_at: 2026-05-07T14:42:00Z
  resolved: false
  suggested_edit:
    from: "an old phrase"
    to: "a new phrase"
  body: |
    Tighter wording.
-->
```

Wrapping the entire YAML in a single HTML comment means the block is invisible in any rendered markdown view, while remaining plain text and trivially readable by humans or AI agents inspecting the raw file. The opening line `<!-- forgemark-comments` doubles as the format identifier; any tool can locate the block by searching for that exact string.

Two short sequences are reserved inside user content (the `body`, `anchor_text`, `context_before`, and `context_after` fields), since they collide with HTML comment syntax: `-->` and `<!--`. On serialize they are escaped to `--\>` and `<!\--` respectively, and reversed on load. These are the only reserved sequences in user content; both occur rarely in prose.

The duplication of `anchor_text` and the `context_before` / `context_after` fields in the YAML is load-bearing, not redundant. It lets an AI agent rewriting a paragraph in isolation match comments to passages without scanning the whole document for inline markers, and it allows orphan recovery (see Comment Storage and Diffing below) when markers have been stripped or text has been edited.

**Schema reference** for each comment object:

- `id` (integer, required) — sequential within the file, starting at 1.
- `anchor_text` (string) — the text wrapped between the inline markers. Required for anchored comments; omitted (or empty) for floating notes (`floating: true`).
- `context_before` / `context_after` (string, recommended) — roughly one sentence on either side of the anchor, used for orphan recovery. Omitted for floating notes.
- `author` (string, required) — free-form name. Humans set this in preferences; AI agents pick their own (e.g., "Claude", "ChatGPT"). Human and AI authors are not distinguished in the schema.
- `timestamp` (string, required) — ISO 8601 in UTC (e.g. `2026-05-07T14:32:00Z`).
- `edited_at` (string, optional) — set when the original author edits the body. Same format as `timestamp`.
- `resolved` (boolean, default `false`).
- `body` (string) — the comment text, typically as a YAML literal block (`|`). Required for plain comments; optional for suggestions, where the suggestion itself can stand alone.
- `replies` (list, optional) — entries have `author`, `timestamp`, `body`, optional `edited_at`. Replies are stored in chronological order.
- `suggested_edit` (object, optional) — if present, the comment is rendered as a suggestion. Keys: `from` (the text to replace) and `to` (the proposed replacement).
- `floating` (boolean, optional, default `false`) — when true, the comment has no inline marker pair in the body and `anchor_text` may be omitted. The card lives in the sidebar's Floating Notes section. Used both as a steady-state for comments that don't pin to a passage and as a non-destructive landing for orphaned anchors the user chooses to keep.

**Suggested-edit acceptance** matches the Google Docs / Word convention. Accepting a suggestion replaces the anchored text with `to`, removes the inline markers, and removes the comment object (and any replies) from the YAML block entirely. Rejecting a suggestion leaves the original text in place and likewise removes the markers and the comment. Both actions are terminal — there is no "resolved suggestion" state.

**Resolved comments** (non-suggestion threads marked resolved) are kept in the YAML block with `resolved: true`. The sidebar collapses them; the inline highlight decoration in the editor view is dimmed rather than removed, so the reader can still see where past annotations existed. The marker comments themselves are invisible to any renderer regardless of state.

**Forward compatibility.** Parsers should ignore unknown fields on a comment object (or unknown top-level keys) and preserve them on round-trip. This lets future versions of the format add fields without breaking files opened in older versions of the application.

**Failure modes.** The chief fragility of this format is HTML-comment stripping. Because the entire block lives inside one HTML comment, any tool that strips HTML comments and re-saves the file destroys all annotations in one shot. In practice this is narrow: ordinary editors, git, Dropbox, email, and direct file exchange between two copies of this application all preserve the block. The risk shows up only when the file passes through a third-party tool that re-emits markdown without HTML comments — some static site generators with aggressive sanitizers, certain CMS importers, occasional editor "clean up" features, and platforms that sanitize HTML for XSS reasons. The "clean export" option (see File Handling) is the deliberate version of this stripping. YAML linters that reformat the content between the sentinels are harmless as long as the opening `<!-- forgemark-comments` and closing `-->` lines are preserved.

### Format Spec for AI Authors

AI agents are co-primary users and need to write valid comments without going through the GUI. To support this, the application ships with a downloadable skill package — a `.skill` folder or archive — that bundles the format specification, a few example files, and a brief usage guide. AI agents that have loaded the skill can read and write comments in this format correctly without having to derive it from examples in a particular file. The skill is built alongside the application, distributed from the application itself (and from the project repo), and kept small enough that loading it does not meaningfully grow an agent's context window.

The minimum normative requirements an AI agent must satisfy to write a valid comment:

1. Locate or create the comments block at the end of the file. The block opens with `<!-- forgemark-comments` on its own line and closes with `-->` on its own line. There is at most one such block per file.
2. Between those delimiters, maintain a YAML list of comment objects. Required fields are listed in the Storage Format schema reference above.
3. Assign each new comment an integer `id` one greater than the current maximum in the file (1 if there are no existing comments).
4. Wrap the anchored passage in the document body with paired HTML-comment markers: `<!-- fmc:N -->…<!-- /fmc:N -->`, where `N` is the comment ID. **Skip this step for floating notes** — see rule 8.
5. Use ISO 8601 in UTC for all timestamps.
6. In user-provided string fields, escape `-->` as `--\>` and `<!--` as `<!\--`.
7. Pick any name for `author`. Self-identification is by convention only.
8. **Floating notes.** If you encounter a comment with `floating: true`, do not insert inline markers for it; the comment lives only in the YAML block and `anchor_text` may be absent. You may also author a floating note yourself by setting `floating: true` and omitting the markers — useful when you want to leave a general comment that doesn't pin to a single passage.

### File Handling

Opening a file detects an existing comments block and renders the comments in the sidebar. Saving a file writes back the full document, including the updated comments block when comments exist. A file with no comments is saved without any comments-block scaffolding — clean files stay clean. The application should never silently modify the markdown content above the comments block; the only edits to that region come from accepted suggested edits and explicit user actions in the editor.

A "clean export" option produces a copy of the file with all comment markers and the comments block removed, for cases where the reviewer wants to share a final version without annotations.

### Rendering

The main editor pane shows rendered markdown, not raw source. Standard markdown features are supported: headings, lists, tables, code blocks with syntax highlighting, links, images, and footnotes. GitHub Flavored Markdown is the baseline dialect.

A toggle switches to raw source view for users who want to see the underlying file, including the comment markers and block.

### Preferences

The application exposes a small set of user preferences:

- **Author name.** A single free-text field used to attribute every comment, reply, and suggested edit the user creates. There is no separate identity object — just a name.
- **Theme.** Light and dark modes.
- **Font size.** Adjusts the editor and sidebar text size.

Preferences are stored using the OS-native preferences mechanism (`~/Library/Preferences` on macOS, the equivalent AppData location on Windows) — Tauri's settings plugin or its raw filesystem APIs are appropriate. The storage location of the comments block, by contrast, is deliberately not configurable; see Storage Format.

## Technical Approach

### Platform

The application targets macOS first, with Windows as a secondary target. **Tauri** is the recommended framework: it produces small native binaries, has good cross-platform support, uses the system webview for rendering (avoiding the bundled-Chromium bloat of Electron), and lets the bulk of the UI be written in standard web technologies (TypeScript, a framework like Svelte or React) while filesystem and OS integration is handled in Rust.

Electron is a viable alternative if the team prefers a pure-JavaScript stack, at the cost of larger binaries and higher memory use.

A pure-native approach (Swift on macOS, separate Windows codebase) is rejected as too expensive for a tool of this scope.

### Markdown Engine

A well-maintained markdown parser with AST access is needed so that comment anchors can be inserted at precise text positions without corrupting surrounding markup. **remark** (with `unified`) or **markdown-it** are both reasonable choices in the JavaScript ecosystem. The parser scans for inline marker comments (`<!-- fmc:N -->` and `<!-- /fmc:N -->`) only outside of fenced code blocks and inline code spans, so users can safely document the format inside code samples without triggering false anchors.

### Editor Component

The rendered-markdown editing surface is the hardest UI component. **ProseMirror** (or the higher-level **Tiptap** built on it) is well-suited: it allows rich-text-like editing while round-tripping cleanly to and from markdown source, and it has strong support for decorations (the visual layer needed to show comment highlights without modifying the underlying document).

**CodeMirror 6** is a strong alternative if the team prefers a source-with-overlay approach rather than a fully rendered WYSIWYG view.

### Comment Storage and Diffing

The YAML-in-HTML-comment block is parsed on file open and serialized on save. Anchor positions are tracked using a combination of the paired `<!-- fmc:N -->` / `<!-- /fmc:N -->` markers, the `anchor_text` stored in the YAML, and the surrounding `context_before` / `context_after` strings.

Because AI agents are co-primary users and are expected to edit the document, anchor drift is the common case rather than an edge case. The reattachment strategy proceeds in order: (1) if both inline markers for the comment are present, use them; (2) otherwise, look for an exact match of `anchor_text` and verify the surrounding context matches; (3) otherwise, do a fuzzy match (e.g. token-level Levenshtein) on `anchor_text` within a window of text whose `context_before` / `context_after` neighborhood matches; (4) otherwise, flag the comment as orphaned. Orphaned comments are shown in a dedicated section of the sidebar and the user is prompted to reattach (by selecting the new passage) or discard. Comments are never silently dropped. When only one of the paired markers is present (or both are present but `anchor_text` no longer matches what they wrap), the editor renders a "questioned" highlight in a distinct style and links it to the orphan card so the reviewer can resolve it.

## Differentiation from Existing Tools

This tool is not a better Google Docs and not a better GitHub. It occupies a specific niche: **collaborative review of markdown documents by humans and AI agents working as peers**. The core insight is that the storage format must be both human-pleasant in the editor UI and AI-pleasant in the raw file, with zero friction between the two — and that AI agents must be able to read _and write_ comments using the same format, not just consume them.

No existing tool makes this tradeoff correctly. HackMD and Notion optimize for the human side and abandon the AI side. CriticMarkup and HTML comments optimize for the AI side and abandon the human side. The proposed tool refuses to choose.

## Future Work

Multi-author comment merging — two people (or a person and an AI) commenting on the same file independently and then combining the results — is a meaningful feature for some workflows but adds significant complexity around ID collisions, duplicate threads on the same anchor, and reconciliation UI. It is deferred from the initial release.

## Suggested Next Steps

A short prototype phase would validate the core hypothesis that the YAML-in-HTML-comment storage format is both pleasant to edit through a UI and pleasant for AI agents to read _and write_. The prototype need only support opening a file, adding a single comment via highlight-and-type, saving, and re-opening. The critical empirical test is to feed the resulting file to a current LLM (Claude or similar) and confirm that the agent can (a) reliably address comments when asked to revise the document, and (b) write new comments and replies into the block in valid format without bespoke tooling. If both round-trips work smoothly, the remaining work is mostly conventional desktop development, with the anchor-reattachment logic and the editor decoration layer as the two non-trivial components on top.
