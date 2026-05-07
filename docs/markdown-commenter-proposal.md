# Markdown Commenter: Proposal for a Human + AI Collaborative Review Tool

## Background and Problem Statement

AI agents increasingly produce reports, analyses, and drafts in markdown format. Markdown is an excellent intermediate representation: it is plain text, version-controllable, AI-native, and renders cleanly across many surfaces. However, the tooling for **collaborative review** of markdown documents is poor compared to what knowledge workers expect from Microsoft Word and Google Docs.

Existing options each fail in at least one critical dimension:

- **GitHub pull requests** support precise line-level commenting and threaded discussion, but the workflow is heavy: branches, commits, PRs, and a UI optimized for code review rather than prose review.
- **HackMD, Dropbox Paper, Notion, Google Docs** offer the convenient highlight-and-comment UX users want, but comments live in proprietary sidebars or databases. When the document is exported back to markdown, comments are silently dropped. An AI agent reading the exported file has no idea any review ever happened.
- **CriticMarkup and HTML comments** preserve annotations in plain text that AI agents can parse, but they require the human reviewer to type syntax by hand. There is no editor UX that makes this feel like commenting in Word.
- **Obsidian and VS Code with plugins** get partway there, but the experience is fragmented and oriented toward power users rather than reviewers.

The result is a workflow gap: reviewers either get convenience (Google Docs-style commenting) and lose AI-readability, or they get AI-readability (CriticMarkup, HTML comments) and lose convenience. No tool offers both.

This proposal describes a standalone desktop application that closes this gap.

## Goals

The tool should make commenting on a markdown file feel as natural as commenting in Google Docs, while ensuring that every comment, reply, and suggested edit is preserved in the markdown file itself in a format that AI agents can read and act on without any conversion or extraction step.

A reviewer should be able to open a `.md` file, highlight a passage, type a comment, see the comment in a sidebar alongside other comments, reply to existing threads, resolve threads, and save the file. The saved file should remain a valid markdown document that renders correctly in any markdown viewer, while also containing the full comment history in a structured, parseable form.

## Non-Goals

The tool is not a markdown authoring environment competing with Typora, Obsidian, or iA Writer. Its job is review and commentary, not primary writing. It is not a real-time multi-user collaboration platform like Google Docs; collaboration happens through file exchange (email, Dropbox, git, sending the file back to the agent). It is not a git client or a PR review tool.

## Target Users

The primary user is someone who works regularly with AI agents that produce markdown output: technical reviewers, researchers, R&D leads, investors evaluating proposals, and writers using AI for drafts. The secondary user is the AI agent itself, which needs to read review comments and act on them in subsequent turns.

## Functional Requirements

### Commenting Experience

The reviewer should be able to select any range of text in the rendered markdown view and trigger a comment with a keyboard shortcut or context menu. A comment composition box appears in a right-hand sidebar, anchored visually to the highlighted passage. The reviewer types their comment and submits with Cmd+Enter (or Ctrl+Enter on Windows).

Existing comments appear as cards in the sidebar, sorted by document position. Clicking a comment scrolls the document to its anchor and highlights the referenced text. Hovering an annotated passage in the document highlights the corresponding sidebar card.

Threads support replies. Each reply is timestamped and attributed to an author name configured in app preferences. Threads can be marked resolved, which collapses them in the sidebar but preserves them in the file.

Suggested edits are a distinct comment type. The reviewer can highlight text and choose "Suggest edit" to propose a replacement. Suggestions render with strikethrough-and-insertion styling in the sidebar preview.

### Storage Format

Comments are stored inside the markdown file itself, in a format that is both human-readable when viewed as plain text and parseable by AI agents and other tools without a custom library.

Two complementary mechanisms are used:

**Inline anchors** mark the commented passages in the document body. The format is based on CriticMarkup for compatibility with existing tooling: `{>>comment-id-abc123<<}` markers bracket the commented range. These markers are short, visually unobtrusive, and survive any markdown processor that does not actively strip them.

**A comments block** at the end of the file (or in YAML frontmatter, configurable) holds the structured comment data. This block is delimited by clear sentinels:

```
<!-- COMMENTS-BEGIN -->
---
- id: abc123
  anchor: "the passage that was selected"
  author: Steven
  timestamp: 2026-05-07T14:32:00Z
  resolved: false
  body: |
    This claim needs a citation.
  replies:
    - author: Steven
      timestamp: 2026-05-07T14:35:00Z
      body: |
        Actually, see the appendix.
- id: def456
  ...
<!-- COMMENTS-END -->
```

The comment block is YAML inside HTML comments, which means: it is invisible in any rendered markdown view; it is plain text and trivially readable by humans inspecting the raw file; it is parseable by any AI agent or script using a standard YAML library; and it does not interfere with the markdown content above it.

The combination of inline anchors plus a structured trailing block means an AI agent reading the file can see exactly which passages were commented on and what was said, with no special tooling.

### File Handling

Opening a file detects existing comment blocks and renders them in the sidebar. Saving a file writes back the full document including updated comment block. The application should never silently modify the markdown content above the comments block; the only edits to that region come from accepted suggested edits, which are applied explicitly by the user.

A "clean export" option produces a copy of the file with all comment markers and the comments block removed, for cases where the reviewer wants to share a final version without annotations.

### Rendering

The main editor pane shows rendered markdown, not raw source. Standard markdown features are supported: headings, lists, tables, code blocks with syntax highlighting, links, images, and footnotes. GitHub Flavored Markdown is the baseline dialect.

A toggle switches to raw source view for users who want to see the underlying file, including the comment markers and block.

## Technical Approach

### Platform

The application targets macOS first, with Windows as a secondary target. **Tauri** is the recommended framework: it produces small native binaries, has good cross-platform support, uses the system webview for rendering (avoiding the bundled-Chromium bloat of Electron), and lets the bulk of the UI be written in standard web technologies (TypeScript, a framework like Svelte or React) while filesystem and OS integration is handled in Rust.

Electron is a viable alternative if the team prefers a pure-JavaScript stack, at the cost of larger binaries and higher memory use.

A pure-native approach (Swift on macOS, separate Windows codebase) is rejected as too expensive for a tool of this scope.

### Markdown Engine

A well-maintained markdown parser with AST access is needed so that comment anchors can be inserted at precise text positions without corrupting surrounding markup. **remark** (with `unified`) or **markdown-it** are both reasonable choices in the JavaScript ecosystem. The parser must support extensions, since the comment markers are a small custom syntax extension.

### Editor Component

The rendered-markdown editing surface is the hardest UI component. **ProseMirror** (or the higher-level **Tiptap** built on it) is well-suited: it allows rich-text-like editing while round-tripping cleanly to and from markdown source, and it has strong support for decorations (the visual layer needed to show comment highlights without modifying the underlying document).

**CodeMirror 6** is a strong alternative if the team prefers a source-with-overlay approach rather than a fully rendered WYSIWYG view.

### Comment Storage and Diffing

The YAML-in-HTML-comments block is parsed on file open and serialized on save. Anchor positions are tracked using a combination of the inline `{>>id<<}` markers and a copy of the anchor text stored in the YAML, so that comments can be reattached even if the surrounding document is edited externally.

When a file is opened that has been edited outside the application (anchor text no longer matches), affected comments are flagged as "orphaned" in the sidebar and the user is prompted to reattach or discard them.

## Differentiation from Existing Tools

This tool is not a better Google Docs and not a better GitHub. It occupies a specific niche: **review of AI-generated markdown that needs to round-trip back to an AI agent**. The core insight is that the storage format must be both human-pleasant in the editor UI and AI-pleasant in the raw file, with zero friction between the two.

No existing tool makes this tradeoff correctly. HackMD and Notion optimize for the human side and abandon the AI side. CriticMarkup and HTML comments optimize for the AI side and abandon the human side. The proposed tool refuses to choose.

## Open Questions

A few design decisions warrant further thought before implementation begins. Whether comments should live at the end of the file or in YAML frontmatter is partly a matter of taste and partly depends on what tooling users have in their pipeline; supporting both as a configuration option may be wise. Whether the storage format should be standardized and proposed to a wider community (so that other tools could eventually read and write the same format) is a strategic question rather than a technical one. Whether to support multi-author comment merging (two people commenting on the same file independently and then combining results) is a meaningful feature for some workflows but adds significant complexity.

## Suggested Next Steps

A short prototype phase would validate the core hypothesis that the YAML-in-HTML-comments storage format is both pleasant to edit through a UI and pleasant for AI agents to read. The prototype need only support opening a file, adding a single comment via highlight-and-type, saving, and re-opening. If that round-trip works smoothly and an AI agent can read the resulting file and respond to comments naturally, the rest of the application is conventional desktop development on top of a proven foundation.
