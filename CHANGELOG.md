# Changelog

All notable changes to Forgemark are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Review of generated HTML reports, alongside Markdown. Open an `.html` file and comment on it: select a passage and a **Comment / Suggest edit** bar appears above it, or press ⌘⌥M, or click the **Comment** button beside a figure, chart, or table — the only way to point at something with no text to select. Threads, replies, suggestions, resolve, print and clean export all work as they do for Markdown.
- Reports survive being regenerated. Rebuilding a report drops every anchor, so the lost-anchor banner now offers to put back the ones it is sure about in a single action, leaving anything ambiguous for you to decide. Comments made on a figure remember its `id`, so they reattach exactly even when the caption has been renumbered.
- The AI skill covers the HTML variant, including how to rebuild a reviewed report without discarding the review.

### Changed

- Commenting starts the same way in every document: select a passage and a **Comment / Suggest edit** bar appears above it. Markdown keeps ⌘⌥M and its right-click menu as well — the bar is an addition, not a replacement — but it is now the one gesture that works everywhere, which matters because right-click cannot be made to work inside a report.
- HTML reports are review-only: their prose can't be edited in Forgemark, and a chip in the editor says so. Editing them would mean modelling the document, and any model that round-trips through an editor destroys the CSS, inline SVG, and unknown attributes a report is made of. Everything else — commenting, replying, suggesting, accepting a suggestion — still works, because those are edits to the file rather than to a model of it.
- The Open dialog accepts `.html`, `.htm` and `.xhtml`, and Forgemark registers itself as an editor for HTML files.

### Known limitations

- Find (⌘F) is off for HTML reports; Source view is searchable.
- Right-click inside a report opens the system webview's own menu (Look Up, Translate, Copy) rather than Forgemark's. The report is rendered in a frame whose input handling the app does not own, so the selection bar and ⌘⌥M are the ways to comment on a passage.
- Hovering an anchored passage in a report does not highlight its comment card. Hovering the card still highlights the passage.
- Scripts inside a report never run, so a chart drawn in JavaScript renders empty. Static and inline-SVG charts are unaffected.

## [1.5.0] — 2026-07-25

### Changed

- Launching Forgemark no longer reopens the tabs from last time. A launch now opens exactly what it was asked for: the file you double-clicked, or a blank document if you opened the app on its own. Restoring the old tabs meant the working set only ever grew — finishing with a file left you closing its tab by hand so the next launch wouldn't inherit it. Open Recent is still there for getting back to something. Tabs are unaffected while the app is running.

## [1.4.0] — 2026-07-18

### Added

- Multiple documents open at once, as tabs in one window. Opening a file that's already open focuses its tab instead of duplicating it; ⌘O accepts several files at once; closing the last tab leaves an empty Untitled one.
- Session restore: the files you had open reopen on next launch, with the same one focused. Paths are remembered rather than contents, so a file edited elsewhere comes back current. Unsaved Untitled buffers are not restored — they can't be silently lost, because quitting prompts for them.
- Unsaved-work guard on the actions that discard a buffer (closing a tab, quitting). Documents that can be saved are saved silently; you're only asked when auto-save can't help — an Untitled buffer with no destination, or a file that changed on disk underneath you.

### Fixed

- Undo no longer reaches into the previous document. Opening a file left the editor's history intact, so ⌘Z after ⌘O could revert to content from the file you just closed — in an app whose whole premise is byte-faithful round-tripping. Save As still keeps your history, since only the path changes.
- Typing into a new Untitled document did nothing at all. Every keystroke was discarded before reaching app state: the document never went dirty, never auto-saved, and ⌘S would have written an empty file over what was on screen. Typing into an already-saved file was unaffected, which is what made it easy to miss.
- Quitting and closing the window now prompt about unsaved work instead of discarding it. ⌘Q previously bypassed the app entirely on macOS.

## [1.3.0] — 2026-06-21

### Added

- Subscript and superscript rendering: `<sub>`/`<sup>` now display correctly and round-trip losslessly instead of flattening to plain text.
- Comments on whole fenced code blocks. Selecting inside a code block anchors the comment to the entire block, stored as a marker pair around the fence.
- Overlap prompt: trying to comment on text that overlaps an existing comment now offers to reply to that comment instead of corrupting the file. Selecting code that can't be anchored now explains why instead of doing nothing.
- Fail-soft recovery on open: a file with a damaged anchor now recovers the comments it can (re-attaching coalesced ones, flagging the rest for reattachment) instead of hiding every comment.

### Fixed

- The new-comment composer no longer renders off the bottom of the viewport at the end of a document; it clamps on-screen so Save/Cancel stay reachable.
- Anchoring a span that contains inline formatting (`*emphasis*`, `[links]()`) no longer splatters into many duplicate markers that hid all comments; it now emits a single marker pair.
- Creating a comment that overlaps an existing one no longer corrupts the markers (which previously hid every comment in the document).

## [1.2.0] — 2026-05-18

### Added

- Rendered Markdown links now open supported external destinations (`http`, `https`, `mailto`, and `tel`) in the user's default system browser or app.
- Rendered and Source view switching now preserves the current reading area using a viewport-anchor match with a scroll-ratio fallback.

### Changed

- Link clicks inside anchored comment spans now prioritize opening the link instead of only focusing the associated comment card.

## [1.1.0] — 2026-05-16

### Added

- File > Print... with Cmd+P, routed through a Forgemark pre-print sheet before the system print dialog opens.
- Print-only document rendering that hides app chrome and prints rendered Markdown body content rather than raw Forgemark markers or YAML.
- Print review appendix controls for including comments and suggested edits.
- Edit > Find/Replace... with Cmd+F, plus editor-style shortcuts for replace mode, next/previous match, and using the current selection as the find text.
- In-window find/replace bar for rendered document prose, with next/previous navigation, match counts, replace, replace all, and read-only-safe replace controls.

### Changed

- Simplified find/replace to literal, case-insensitive rendered-body search so it ignores the comments sidebar, source view, YAML, and raw markers.
- Refreshed repository documentation so future agents can understand the project from the docs before diving into code.

### Fixed

- Print continuation now invokes the native Tauri print path instead of returning silently to the document.
- Find/replace layout now stays compact in replace mode without controls overlapping the match count.
- Text fixture line endings are normalized across platforms so Windows CI no longer mutates LF-sensitive round-trip fixtures.
- E2E smoke tests now start with first-run onboarding dismissed, matching the assumptions of the shell interaction tests.

## [1.0.0] — 2026-05-08

The first public release. Forgemark is a desktop app for collaborative review of markdown documents — by humans and AI agents working as peers. Comments, threaded replies, and suggested edits all live inside the `.md` file itself, so an AI agent reading the raw file sees the full review context with no special tooling.

### Added

#### File format

- Inline `<!-- fmc:N -->...<!-- /fmc:N -->` markers wrap anchored passages.
- A single trailing `<!-- forgemark-comments ... -->` HTML comment holds a YAML list of comment records with `id`, `anchor_text`, `context_before` / `context_after`, `author`, `timestamp`, `resolved`, optional `body`, optional `replies`, optional `suggested_edit`, and optional `floating: true`.
- Round-trip parity is a hard contract: parse → serialize is byte-equivalent for every fixture.
- A custom byte-deterministic YAML emitter keeps output stable across versions.
- Escape rules: `-->` ↔ `--\>` and `<!--` ↔ `<!\--` for user-content fields.
- Unknown YAML fields are preserved across round-trip for forward compatibility.
- Tolerant parse mode keeps comments whose markers were stripped externally so the lost-anchor flow can surface them.

#### Editor

- Tiptap-based rendered view with markdown round-trip.
- CodeMirror 6 source view (read-only) with markdown highlighting; `<!-- fmc:N -->` markers dimmed and the trailing comments block tinted.
- Selection-driven new-comment composer, with a Suggest-edit toggle for from→to replacements.
- Rendered ↔ Source toggle (⌘⇧M); per-document, resets on file open.

#### Comments

- Inline anchor highlights synced with the sidebar; click a card to scroll the editor to its anchor (and vice versa in source view).
- Action row revealed on focus: Reply, Edit (own only), Resolve, Delete.
- Resolved cards collapse to a one-line preview unless focused.
- Suggested edits: Accept replaces anchored text and removes the comment; Reject strips markers and removes the comment. Both terminal.
- Threaded replies, edit own / delete own affordances on replies.

#### Lost-anchor recovery (Phase 9)

- Anchor classifier returns `attached` / `orphaned` / `floating` per comment in one pass.
- Reattachment strategy: marker pair → exact `anchor_text` match (with context boost) → fuzzy token-window match. 50k-word body × 50 orphans classifies in well under 2s.
- Top-of-pane lost-anchor banner; sidebar **LOST ANCHOR · N** section; per-card Reattach… CTA.
- Three-option Reattach modal: Reattach here / Keep as floating note / Discard. Empty-candidate state offers Keep / Discard only.
- Floating notes: `floating: true` records, no markers, sidebar **FLOATING NOTES · N** section.

#### File-conflict surfaces (Phase 10)

- File watcher with mtime fast-path + SHA-256 content-hash detection. Touch-saves don't fire false positives.
- File-conflict banner when no unsaved work.
- Edit-during-open modal when there's unsaved work, with summary of unsaved items.
- Save-conflict modal on ⌘S during a conflict, with two diff signals (comments added/removed, body bytes changed) and an "Unknown changes" fallback for unparseable disk content.
- Cancel preserves the conflict and re-opens the modal on next ⌘S.

#### App chrome (Phase 11)

- Native macOS menu bar: File / Edit / Comment / View / Window. Menu items emit `forgemark:menu` events that the renderer routes to existing keyboard handlers.
- Settings window (⌘, or titlebar gear): Author name, Theme (Light / Dark / System), Font size (14–22), Default view (Rendered / Source).
- AI Participation section with two filled-blue download buttons (Phase 12).
- First-run welcome screen with the Forgemark glyph, name field, and Skip / Open sample.
- Production sample document at `assets/sample-onboarding.md` (~600 words, 5 comments covering every state).
- Clean Export (⌘⇧E): comment-free `.md` copy with markers stripped.
- Open Recent persistence (≤10 entries).
- Save-on-close prompt (browser-level beforeunload while dirty).

#### Skill package (Phase 12)

- `assets/forgemark-skill/` source tree: `SKILL.md`, `AGENTS.md`, `README.md`, three `examples/*.md`. Total source 14 KB; bundle 6.6 KB; size budget cap 60 KB.
- `npm run build:skill` produces `forgemark-skill.skill` (Claude) and `forgemark-skill.zip` (Codex) from a single deterministic ZIP — byte-identical artifacts, asserted via sha256.
- Settings → AI Participation downloads either artifact via Tauri's native save dialog.
- `npm run verify-ai-output` CLI for validating captured AI outputs locally.

### Tested

- 303 automated tests (unit + integration + property-based + perf), green on every push.
- Twenty-plus AI-agent test cases across READ / WRITE-comment / WRITE-reply / WRITE-suggestion / WRITE-statechange / RECOVERY / CONFLICT / ESCAPES / FORMAT-FIDELITY categories. All catalogued under `tests/ai/cases/` with prompts and last-run results. AI tests are run manually (never in CI) — they call live LLMs and are stochastic by design.
- Round-trip hard gate: 8 fixtures byte-equivalent through parse → serialize, plus a property-based test that builds random documents and verifies the contract.
- Phase 9 fuzzy-match perf: 50k-word body, 50 orphans, < 2s.
- Phase 13 end-to-end perf: 30k-word file, 50 existing comments, add 5, save, reopen — under 10s.

### Deferred to v1.1

- Auto-update infrastructure for the app binary.
- Multi-document switcher / project concept.
- In-app undo for terminal actions (Accept / Reject / Discard).
- Body-edit diff view when AI edits prose alongside comments.
- A read-only diff drawer for save-conflict inspection.
- Localization beyond Latin scripts.
- Mobile / web variants.

`// TODO(forgemark-v1.1)` markers in code call out the hooks where each feature would land.

### Known limitations

- macOS save-on-close prompt currently uses the browser-level `beforeunload` warning instead of a native sheet. Replacing it with `dialog::ask` from a Tauri close-event listener is straightforward and will land in the first patch release.
- Inline `code` spans in the rendered view drop the anchor mark on copy because ProseMirror treats `code` as exclusive. Documented as a known minor quirk; doesn't affect the file's bytes.
