# Changelog

All notable changes to Forgemark are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A command-line tool for AI agents, shipped inside the skill as `scripts/forgemark.mjs`. `list`, `show`, `comment`, `reply`, `resolve`, `float`, `reattach`, `delete`, and `lint` do everything an agent needs in a review without it ever composing the comments block or placing a marker by hand. It is built from the app's own parser and serializer, checks that every write reads back, and writes atomically; passages are named by quoting them, and the tool refuses an ambiguous phrase or one that overlaps another comment rather than guessing. Works on Markdown and HTML reports, including whole-element anchors by `id`.
- `forgemark lint` reports everything the app would refuse in a file — with the file line and the comment record for an unreadable block — plus the things a reviewer would rather not meet: an orphaned comment, an anchor description that has drifted, a malformed timestamp.

### Added

- The sidebar header counts lost anchors, offers Resolve all for the open comments it is showing, and ⌘⌥B hides and shows the sidebar.
- File > Open Recent. The last files opened are listed in the native menu, newest first, with Clear Menu at the bottom; an entry the app can no longer open is dropped from the list.
- Every keyboard shortcut is now defined in one table, and a test refuses two commands sharing a chord. ⌘⇧E used to open Clean Export, the edit composer, and Find with the selection all at once; it now opens Clean Export only, and editing your own comment is E with the card focused. Card shortcuts act only while the keyboard focus is in the sidebar, never over an open dialog, and never while typing.
- Tabs from the keyboard: ⌘⇧] and ⌘⇧[ move between tabs, ⌘1 to ⌘9 jump to one, and arrow keys walk the tab strip. In the sidebar, ↑/↓ (or j/k) move between comment cards.
- Deleting a comment can be undone for a few seconds from a banner. It restores the thread, its replies, and its markers exactly.

### Fixed

- GitHub alerts (`> [!NOTE]` and the other four kinds) and footnotes (`[^1]` with `[^1]: text`) are rendered as GitHub renders them, and an edit near either keeps it. Both used to show as literal text and come back escaped and broken after an edit. A single tilde strikes through, as the GFM spec allows. A pipe written as `\|` in a table cell stays escaped when the table is edited instead of splitting the cell.
- Bare `https://…` and `www.` addresses and e-mail addresses are links again, under GitHub's rule: a scheme, `www.`, or an `@`, never a bare domain, so `SKILL.md` stays text. An edited paragraph writes such an address back bare rather than as `<…>` or `[…](…)`.
- Raw HTML blocks in Markdown are rendered as GitHub renders them: a centred `<p align="center">` image, an `<img>` with a width, an HTML table, a `<details>` summary. Anything that runs or loads (scripts, frames, event handlers) is left out of the page and kept in the file. A block with nothing to show, such as an HTML comment, keeps its quiet placeholder.
- Editing a paragraph no longer strips the inline HTML in it. `<kbd>`, `<mark>`, `<ins>`, `<abbr>`, `<small>`, `<cite>`, `<span>` and the other inline tags GitHub renders now display as those elements and come back as written; an HTML comment, a `<wbr>`, or a tag GitHub does not render is kept for the file and shown as nothing. Images are inline, so an image inside a link keeps its link, an image in a sentence stays in it, and an `<img>` with a width or height keeps it.
- A comment anchored across bold or italic text lost part of its passage each time the paragraph was edited: the anchor was an editor mark ranked outside the emphasis, so its markers came back inside the `**` and the anchor shrank on the next pass. Each marker is now its own inline node and serializes exactly where it sits. Backspace and Delete beside a marker remove the character beyond it rather than the marker, a marker whose partner a deletion swallowed is removed with it so the file never gets a stray one, and pasting a copy of an anchored passage no longer duplicates its markers.
- On Windows, double-clicking a `.md` or `.html` file now opens it: the installer registered the associations but nothing read the path. A second double-click while the app is running opens the file in the existing window instead of starting a second copy. On every platform, a file handed over during a cold start can no longer be dropped by arriving before the app was listening.
- After printing once, a hidden second copy of the editor stayed mounted and re-parsed the document on every keystroke, slowing typing for the rest of the session.
- Comment bodies showed code identifiers wrongly: `snake_case_name` lost its underscores and `a * b * c` its stars.
- "Doc order" in the sidebar sorted by comment id, which is creation order, rather than by where each anchor sits in the document.
- Clean Export opened the save dialog as "Untitled" instead of proposing `<name>-clean.md`.
- The banner for a file whose comments block could not be read appeared on the previous tab, not the one that opened.
- Clicking the document while writing a reply threw the draft away; a non-empty draft now survives a click outside (Escape still cancels).
- A persisted "By <author>" filter left the filter menu blank in a file with nothing by that author.
- Clearing the author name in Settings wrote an empty author into every comment until the next launch.
- Stepping through Find matches no longer pops the Comment toolbar over each one.
- The report view no longer re-scans every figure and icon twice per resize, and hidden document panes no longer open their own right-click menu behind the visible one. The comment toolbar no longer inherits the nudge from a previous selection.
- Replace no longer changes a match that straddles the edge of a comment's anchor, which used to move or remove the anchor silently.
- ⌘Z after deleting a comment, accepting a suggestion, or reattaching one used to revert the text of that change while the comment records stayed put, leaving markers for a comment that no longer existed. Those changes are no longer undo steps in the editor; undo is for typing.
- Adding a comment to a Markdown document rewrote the whole file in the editor's dialect: front matter became a heading, bare filenames were autolinked, hard-wrapped paragraphs were unwrapped, reference links inlined, HTML comments deleted. A comment now splices its two markers into the untouched source, so a review-only session leaves every other byte as the author wrote it. When the selected passage appears more than once, its surroundings pick the right one.
- Typing rewrites only the block you type in, keystroke after keystroke; a reference link inside the block you edit is inlined rather than turned into literal brackets. The document is split into top-level blocks, the editor shows one node per block, and an edit re-serializes just the blocks whose nodes changed and splices them back into their own lines; every other line stays as the author wrote it. Raw HTML blocks (comments, `<div>`s) are shown as read-only placeholders in the rendered view and written back exactly. Front matter, hard wraps, reference links, footnotes, escapes, and table alignment now survive a session of editing elsewhere in the file.
- What the editor still rewrites in the block you type in has shrunk: front matter is kept aside and put back, bare filenames and addresses are no longer turned into links, bold text is no longer split around inline code, an anchor that touches inline code keeps its markers, markers quoted inside a code fence are left alone, a code block inside a list no longer gains a blank line per save, and a fence that quotes another fence is no longer cut short.
- Saving from the app failed with "forbidden path" for every file: the temporary file the atomic write creates was hidden (dot-prefixed), which the filesystem scope refuses. The temporary file sits beside the document without a leading dot, and the scope now admits hidden paths so a document inside a hidden folder can be opened.
- Auto-save and ⌘S could overwrite a change another program had just made to the file — an agent's reply, another editor's save — because the file watcher reports changes with a delay and nothing checked the disk before writing. Every write now compares the file on disk with what was last read or written, and surfaces the change instead of writing over it. The watcher's own delay is shorter, and the app writes through a temporary file and a rename, so a reader never sees a half-written document.
- Quitting with a read-only document that held an unsaved comment hung the app. It now asks, and offers Save As; ⌘S on a read-only file also offers Save As instead of doing nothing.
- A keystroke typed while a save was in flight was thrown away when the save finished. Edits made during a write now survive and are saved by the next auto-save.
- Closing a tab or quitting when the silent save failed (disk full, permissions) closed anyway. It now asks what to do, with the error shown.
- "Save" from the unsaved-changes prompt on an Untitled buffer saved the file but never closed the tab. Save As also no longer resets the view mode, and refuses a path that is already open in another tab.
- Save As proposes the document's own name instead of "Untitled".
- A comment whose anchor crossed a hard-wrapped line could be written as YAML the app could not read back, hiding every comment in the file on the next open. Such values are now quoted, and the app parses its own output before writing it.
- Opening a file whose comments block could not be read, then adding a comment, appended a second block with colliding ids. Saving now refuses in that state and says where the unreadable block is, so it can be repaired; prose edits still save.
- The error shown for an unreadable comments block now names the line and the comment id instead of "couldn't be parsed (yaml)".

### Changed

- Every text button in the app is drawn by one stylesheet family (`fm-btn` with size and role modifiers) instead of eight near-identical rulesets, so hover, focus, and disabled states are the same everywhere.
- Timestamps on comment cards and the hints under Settings fields and composers are drawn at the readable muted tone rather than the decorative faint one. The hover, selected-segment, and danger backgrounds are theme tokens instead of literals copied into nine stylesheets.
- The app now ships a content-security policy: scripts only from the app itself, images from the app, data URLs, and HTTPS, frames only for the report view. The filesystem scope stays unrestricted, and says why. The release script no longer prints the Apple app-specific password in its log, the version script matches only the top-level version key, and CI builds the macOS app on pushes to main instead of finding bundle breakage on release day.
- Dead code removed: a reducer action, a file-open helper, a test-only fingerprint helper, two HTML helpers, and the styles for an in-frame button that no longer exists; the marker regex and the "which anchor is this node in" lookup exist once each. Two unused npm packages and two unused Rust crates are gone. A file at a Windows drive root is watched correctly, and a watcher event that names no path no longer triggers a read.
- Every dialog now uses one modal shell built on the native `dialog` element: it takes focus when it opens, gives it back to whatever opened it when it closes, traps Tab inside itself, and answers Enter only from within. Comment cards are focusable regions rather than buttons, so screen readers hear their content and the reply controls are reachable by keyboard. The Rendered/Source switch and the Settings choices share one segmented control that moves with arrow keys.
- The test suite mounts the app through one shared harness against one in-memory fake of the Tauri plugins, replacing identical mock blocks in thirty files. Five tests that mounted the document bindings twice, and so ran two auto-save timers against one document, now mount them once. Timing assertions moved behind `npm run test:perf`. The unused AI test harness, its SDK dependency, and the unused retry helper are gone.
- The skill's instructions lead with the tool; the format reference stays for reading a file and as a fallback. The spec now states that `anchor_text` is advisory and how it is normalised, that ids stay sparse after deletions, and how a regenerated report keeps its review.
- `npm run verify-ai-output` is now `forgemark lint` over the built tool (the previous script depended on a package that was not installed).

## [1.6.0] — 2026-08-18

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
- Switching between Rendered and Source in a report does not keep your place, as it does in a Markdown document; it returns to the top.
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
