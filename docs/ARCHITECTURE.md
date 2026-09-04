# Forgemark architecture

This is the fast path for future agents and contributors who need to
understand the repository before making changes. The README explains what
Forgemark is; this file explains how the code is put together.

## Product shape

Forgemark is a Tauri desktop app for reviewing documents — Markdown files and
generated HTML reports. Review data lives inside the file itself:

- Inline marker comments wrap anchored passages: `<!-- fmc:N -->...<!-- /fmc:N -->`.
- A trailing `<!-- forgemark-comments ... -->` block stores comment records as
  YAML.
- The AI-facing format spec lives in `assets/forgemark-skill/SKILL.md`,
  alongside a command-line tool agents use instead of writing the format
  by hand. See "The agent CLI" below.

The app treats the parsed document as two values: `body` and `comments[]`.
Opening a file parses it into that shape. Saving serializes the shape back to a
single file.

`DocumentState.format` is `"markdown"` or `"html"`, decided from the extension
at open time and fixed for the document's life. See "HTML documents" below —
the short version is that the storage format is identical in both, and only
marker _scanning_ and the rendered view differ.

## Runtime stack

- Frontend: React 18, TypeScript, Vite.
- Desktop shell: Tauri 2, Rust, `@tauri-apps/plugin-dialog`, and
  `@tauri-apps/plugin-fs`.
- Rendered Markdown editor: Tiptap with `tiptap-markdown`.
- Source view: CodeMirror 6, read-only.
- Tests: Vitest with jsdom for unit/integration/perf, Playwright for the
  browser smoke surface, optional AI-agent tests.

## Application flow

`src/main.tsx` starts the native-menu bridge and mounts `App`.

`src/App.tsx` wraps the UI in:

- `ThemeProvider`, which applies CSS token variables.
- `DocumentProvider`, which owns the workspace of open documents.
- `AppShell`, which composes the title bar, tab bar, editors, sidebar, modals,
  conflict surfaces, settings, and first-run welcome.

Most meaningful state changes go through `src/state/document.ts`. Most
side effects live in `src/state/DocumentBindings.tsx`.

## Multiple open documents

Forgemark opens several documents at once as **tabs in one window**. Multiple
windows were considered and rejected: Tauri capabilities are scoped to the
`main` window, the `PendingFiles` queue drains destructively, and both the menu
handler and `RunEvent::Opened` emit app-globally — each would need bespoke
per-window routing, on top of a second copy of the whole React app.

The shape is a thin layer over the single-document reducer:

- `src/state/workspace.ts` holds `{ docs: Record<DocId, DocumentState>, order,
activeId }`. `reduceWorkspace` routes document actions to one document and
  handles the tab-level ones (`openTab`, `closeTab`, `activateTab`,
  `reorderTab`).
- **`reduceDocument` is untouched by any of this.** A document is still exactly
  a `DocumentState`.
- `useDocument()` returns the **active** document with the same shape it always
  had, so components and tests that predate tabs need no changes.
  `useWorkspace()` exposes the tab list and `dispatchTo(docId)`.

Two rules govern anything mounted per document:

1. **Per-document things mount for every OPEN document**, not every visible one.
   `DocumentBindings` (auto-save, file watcher) and `EditorPane` (so undo,
   cursor, and scroll survive a tab switch) are both mounted N times. A
   background document whose bindings weren't mounted would silently stop
   saving and stop noticing its file changed on disk.
2. **`window`-level listeners are gated on `isActive`.** Shortcuts, menu
   commands, `forgemark:capture-view-sync`, and the quit guard are app-wide
   singletons; without the gate, N open documents each answer every keystroke.

Inactive editor panes are hidden (`hidden` + `display: none`), never unmounted.
Mounted editors cost roughly 9 MB and 48 ms each at 30,000 words, ~1.6 MB at a
more typical 5,000 — paid at open time, not per switch.

Two behaviors fall out of the format rather than taste:

- **Opening an already-open file focuses its tab.** Two tabs on one path would
  run two watchers and two auto-save loops against the same file, overwriting
  each other and each tripping the other's external-change detection.
- **Untitled buffers are numbered** (`Untitled 2`, lowest free index reused),
  because without a path there is nothing else to tell them apart.

Closing the last tab leaves a fresh Untitled one and keeps the window open
(TextEdit / Pages convention).

Tabs are a **within-session working set**: they last as long as the app runs and
do not survive a relaunch. See "Starting clean" below.

## Unsaved work

Auto-save writes 500ms after the last edit, but skips Untitled buffers (no
destination) and documents with a pending conflict (writing would clobber the
disk copy). Those two gaps are where work can actually be lost, so
`guardDiscard` in `DocumentBindings` gates the actions that destroy a buffer:
closing a tab, and quitting.

Forgemark is auto-save-first, so prompting to save something auto-save would
have written moments later would be incoherent. The rule is **save it for them
when we can, ask only when we can't**:

| Situation               | Behavior                                     |
| ----------------------- | -------------------------------------------- |
| Clean, or read-only     | proceed                                      |
| Dirty, has a path       | save silently, then proceed                  |
| Dirty, Untitled         | Save As… / Don't Save / Cancel               |
| Dirty, conflict pending | Don't Save / Cancel — **no Save**, see below |

No Save during a conflict: writing then would clobber the disk copy, and that
decision belongs to the conflict surfaces.

⌘N and ⌘O open tabs and discard nothing, so they don't prompt.

**Quitting.** Rust intercepts both doorways — `WindowEvent::CloseRequested`
(red button / ⌘W) and `RunEvent::ExitRequested` — and blocks the exit, because
only the frontend knows whether there's unsaved work. Note the App menu's Quit
is a **custom** item: the predefined one maps to NSApplication `terminate:` on
macOS and tears the process down without entering Tauri's event loop, so the
guard would never run. The frontend walks the tabs, bringing each unsaved
document forward in turn, then calls `approve_exit`, which sets a flag and exits
(the flag matters — `app.exit` re-enters `ExitRequested`, and without it the app
could never quit).

## Starting clean

A launch opens exactly what it was asked for: the file the OS handed over
(Finder, drag-onto-dock, `open`), or a blank Untitled buffer when the app is
launched on its own. Nothing carries over from the previous run.

Earlier versions restored the last session's tabs from localStorage. It read as
a feature and behaved as a chore: because the working set only ever grew, every
launch inherited the last one's clutter, and finishing with a file meant
remembering to close its tab or finding it again among a dozen others next time.
Reaching a file you had open is already cheap — Open Recent — while un-reaching
the ones you didn't want was not.

The deliberate consequence: closing the app is how you clear the desk. Tabs mean
"what I'm working on now", not "what I have ever worked on".

## HTML documents

`<!-- fmc:N -->` and the trailing `<!-- forgemark-comments -->` block are both
valid HTML, so the storage format transfers with no syntax change: the parser,
serializer, YAML emitter, and splice helpers are language-blind and take no
`format` argument. Three things do differ.

**Where a marker may sit.** `findMarkers` dispatches on `DocFormat`. The
Markdown scanner is wrong for HTML in two ways, both measured against a real
report before the HTML scanner was written: its indented-code rule makes
markers invisible (HTML is indented as a matter of course), and it reads
marker-shaped text inside `<script>` or an attribute value as a real anchor —
which invents a marker with no YAML record, an error that blanks every comment
in the file.

**How the document is rendered.** `HtmlView` writes the source verbatim into an
iframe. It is _not_ parsed into an editor model, and can't be: a generated
report is a `<style>` block, inline `<svg>`, and a pile of CSS classes, none of
which survives a round trip through a ProseMirror schema. Two details carry
weight:

- `sandbox="allow-same-origin"` **without** `allow-scripts`. The report's own
  scripts never run, while the host can still reach `contentDocument` to
  decorate anchors and read selections. The two flags together would be
  equivalent to no sandbox, so `allow-scripts` is not offered.
- An iframe rather than a shadow root. The example report defines its whole
  palette on `:root` with a `prefers-color-scheme` block, and `:root` does not
  resolve inside a shadow root.

The document is written with `document.write` rather than handed over as
`srcdoc`: writing is synchronous, so there is no load event to race, and it is
the only one of the two that jsdom implements.

**How a selection becomes an anchor.** The source is never re-serialized —
the browser's serializer re-quotes attributes and re-encodes entities, so
saving would rewrite the whole file and the round-trip guarantee would die on
the first comment. Instead `format/html/textmap.ts` builds a per-character map
from the rendered text to source bytes (parse5 for a spec-correct tree with
source spans; its decoded text doubles as an oracle for our own entity decode),
and markers are spliced at exact offsets.

The DOM side (`services/htmlDom.ts`) and the source map meet on one shared
coordinate: an index into the concatenated rendered text. Going through a
character index rather than node identity is what keeps it valid after
decoration wraps anchored passages in spans and splits those very nodes. **Both
walks must cover the same tree** — the DOM walk starts at the Document, not
`<body>`, because whitespace between `</head>` and `<body>` is parsed as a text
node child of `<html>`, and starting at body puts every later offset one
character short. UI that Forgemark injects into the frame is tagged
`data-forgemark` and skipped for the same reason.

**Nothing may depend on an event reaching the frame.** WKWebView does not
deliver `contextmenu`, `mouseover`, or `click` to listeners the host attaches
inside the frame — it answers a right-click with its own Look Up / Translate /
Copy menu, and never runs ours. Chromium does deliver them, so this is not
reproducible in a browser harness and was found only by driving the Tauri
window. Anything the reader must be able to do is therefore built on what the
host can _read_ across the boundary, which `allow-same-origin` grants and which
has never failed:

- The Comment / Suggest edit toolbar watches the selection, polling on an
  interval and nudged by the frame's events where they happen to arrive.
- The per-block Comment buttons live in the _host_ document, positioned over
  the frame. They sit in the pane's margin, falling back onto the block itself
  when the window is too narrow for one.
- Clicking an anchored passage focuses its card via the caret, which the click
  moves and which we can read. It only ever _sets_ focus — clearing from there
  would fight the sidebar.

The in-frame listeners are still attached, because where they do work they are
immediate. They are an optimisation, never the mechanism.

**Consequences that are deliberate, not gaps:**

- HTML documents are review-only. Commenting, replying, suggesting and
  accepting a suggestion all still work, because those are splices on the
  source rather than edits through a model.
- Suggestions are offered only when the source between the markers contains no
  `<`. Accepting replaces everything between them, so a suggestion spanning
  markup would replace tags with a sentence.
- Find is off. It is implemented over the editor's document model, which a
  report doesn't have; Source view is searchable.

**Layout is untested by the suite.** jsdom has no layout engine, so iframe
content-height sizing, the element-comment affordance's position, selection
rectangles, and scroll-to-anchor cannot be covered by Vitest. They were checked
by hand against `tests/fixtures/report.html` in a real browser and all behaved:
the frame sizes to its content with no inner scrollbar, the captured selection
rect matches the on-screen rectangle to within a pixel, adding an anchor
preserves scroll position exactly, and the report follows its own dark-theme
rules while the injected highlight stays legible. Re-check these by hand after
touching `HtmlView`. One trap when doing so: an automated browser tab reports
`document.visibilityState === "hidden"`, and Chromium never ticks a
`behavior: "smooth"` scroll animation in a hidden tab — a smooth scroll that
appears not to move there is the harness, not the code.

**Regeneration is the dominant workflow.** Reports are replaced, not edited, so
a rebuild orphans every anchor. `format/html/candidates.ts` tries the recorded
`anchor_selector` first (exact, and survives a renumbered caption), then locates
an element anchor by its caption widened to the enclosing block, then falls back
to ranking over rendered text. The lost-anchor banner offers a bulk reattach for
unambiguous matches only — a passage that appears twice is exactly the case a
human should look at.

## Core modules

| Area            | Files                                                                                              | Notes                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model  | `src/state/document.ts`, `src/state/DocumentProvider.tsx`                                          | Pure reducer and context. Keeps file path, raw original text, body, comments, dirty state, composer state, lost-anchor state, conflict state, sidebar controls, and `loadGeneration` (see below).                                                                                                                                |
| Workspace       | `src/state/workspace.ts`                                                                           | The open documents: `docs`, tab `order`, `activeId`. Routes document actions to one document; owns tab open/close/activate/reorder, path dedupe, and Untitled numbering. Wraps `reduceDocument` untouched.                                                                                                                       |
| Side effects    | `src/state/DocumentBindings.tsx`                                                                   | Mounted once per OPEN document. Opens/saves files, runs autosave, watches external file changes, consumes pending save requests, and guards unsaved work. Window listeners inside are gated on `isActive`.                                                                                                                       |
| Shell layout    | `src/components/AppShell.tsx`, `src/components/TabBar.tsx`                                         | Assembles the app and hosts modals/banners. Renders one `DocumentBindings` and one `EditorPane` per open document. The tab strip hides itself when only one document is open.                                                                                                                                                    |
| Modals          | `src/components/Modal.tsx`, `Segmented.tsx`                                                        | One dialog shell on the native `dialog` element (focus in on open, back to the opener on close, Escape, backdrop click, Enter scoped to the dialog) used by every modal, and one segmented control with arrow keys for the view switch and Settings.                                                                             |
| Keyboard        | `src/state/keymap.ts`                                                                              | Every chord in one table, `commandFor(event)` for the listeners, and a test that refuses two commands on one chord. Listeners decide where a command applies: card commands only with focus in the sidebar, nothing over a dialog or into a text field.                                                                          |
| Selection UI    | `src/components/SelectionToolbar.tsx`                                                              | The Comment / Suggest edit bar that floats above a selection, in both document kinds. Markdown drives it from ProseMirror's `onSelectionUpdate`; a report has no such guarantee and drives it by reading the frame's selection on an interval, nudged by the frame's own events where those are delivered.                       |
| Rendered editor | `src/components/EditorPane.tsx`, `src/components/RenderedView.tsx`, `src/components/AnchorMark.ts` | Rendered view converts Forgemark markers to Tiptap anchor spans and back. New comments and suggestions are created here because this layer has selection access. One pane per open document; inactive ones are hidden, not unmounted.                                                                                            |
| Source view     | `src/components/SourceView.tsx`                                                                    | Read-only CodeMirror view of the exact serialized Markdown, with decorations for markers and the trailing comments block.                                                                                                                                                                                                        |
| Sidebar         | `src/components/Sidebar.tsx`, `src/components/FMCard.tsx`, `src/components/InlineComposer.tsx`     | Thread lifecycle: reply, edit, resolve, delete, accept/reject suggestions, reattach orphaned comments, filter, and sort.                                                                                                                                                                                                         |
| Format layer    | `src/format/*`                                                                                     | Parser, deterministic YAML emitter, serializer, marker scanning/pairing, marker insertion/removal, lost-anchor candidate ranking, clean export, escaping. This is the domain core and is heavily tested.                                                                                                                         |
| HTML format     | `src/format/html/*`, `src/format/matching.ts`                                                      | Source ↔ rendered-text offset map, element location by selector or caption, HTML reattachment candidates. `matching.ts` holds the ranking policy both languages share.                                                                                                                                                           |
| HTML view       | `src/components/HtmlView.tsx`, `src/services/htmlDom.ts`, `src/services/htmlDecorate.ts`           | The sandboxed report frame, the DOM half of the shared text coordinate, and display-time anchor decoration. Replaces `RenderedView` for HTML documents; the sidebar and threads are unchanged.                                                                                                                                   |
| File services   | `src/services/fileIO.ts`, `src/services/fileWatcher.ts`, `src/services/conflict.ts`                | Tauri wrappers, parent-directory watcher for atomic saves, and fingerprint comparison for external-change detection.                                                                                                                                                                                                             |
| Preferences     | `src/state/preferences.ts`                                                                         | LocalStorage-backed author, theme, font size, default view, recent files, and first-run flag.                                                                                                                                                                                                                                    |
| Open Recent     | `src/state/recentFilesMenu.ts`, `lib.rs` (`set_recent_files`)                                      | The list lives in preferences; the shell pushes it to Rust on change, Rust rebuilds the File menu, and a click comes back as `forgemark:open-path`, the same event a Finder open uses. A failed open drops its entry.                                                                                                            |
| Native shell    | `src-tauri/src/lib.rs`, `src/state/menuBridge.ts`, `src/services/windowActions.ts`                 | Rust builds native menus and file-open events, then emits Tauri events. The frontend routes them into existing command paths.                                                                                                                                                                                                    |
| Skill bundles   | `assets/forgemark-skill/*`, `scripts/build-skill.mjs`, `src/services/skillDownload.ts`             | AI-agent instructions are packaged as both `.skill` and `.zip`; Settings downloads them through the Tauri save dialog.                                                                                                                                                                                                           |
| Agent CLI       | `cli/*`, `scripts/build-cli.mjs`, `assets/forgemark-skill/scripts/forgemark.mjs`                   | `list`, `show`, `comment`, `reply`, `resolve`, `float`, `reattach`, `delete`, `lint` over a file, built from the format layer and bundled into one file the skill ships. Pure operations in `lib.ts`, checks in `lint.ts`, disk and argv in `io.ts` / `run.ts`; anchor placement is `src/format/locate.ts`, shared with the app. |

## Important workflows

Opening a file:

1. `DocumentBindings` calls `openMarkdownFiles` (⌘O, multi-select) or
   `readMarkdownFile` (Open Recent, Finder).
2. `parseForgemarkFile(..., { tolerant: true })` splits body/comments.
3. An `openTab` action puts it in a tab — focusing the existing tab if the file
   is already open, or reusing the current one if it's an untouched Untitled
   buffer.
4. `EditorPane` classifies anchors so orphaned comments can be surfaced.

Saving:

1. If the document is dirty, `serializeForgemarkFile({ body, comments })`
   produces the bytes to write; otherwise the original bytes are preserved.
2. `saveMarkdownFile` writes to the existing path or asks for a destination.
3. The `saved` action refreshes `originalText` and clears `dirty`.
4. The file watcher baseline fingerprint is refreshed so the app ignores its
   own write events.

Adding a comment or suggestion:

**Markdown comments are spliced, not re-serialized.** The editor's
Markdown is not the author's Markdown: run a document through Tiptap and
front matter becomes a heading, hard wraps unwrap, reference links are
inlined, HTML comments vanish (`tests/unit/editor-roundtrip.test.ts`
lists what survives and what still doesn't). So a new comment no longer
goes through the editor at all. `EditorPane.spliceAnchor` finds the
selected passage in `state.body` with `src/format/locate.ts` — the same
locator the CLI uses, matching across hard wraps and inline markup, with
the selection's surroundings disambiguating a repeated phrase — and
splices the two markers in. The rest of the file is byte-identical. The
editor path below is the fallback for a passage the locator can't place.

Typing rewrites only the block typed in. `src/format/blocks.ts`
splits the body into top-level blocks with their line ranges (one per
markdown-it token; a whole-code-block anchor's marker lines are merged
with their fence; raw HTML becomes a "verbatim" block), and
`components/blockSync.ts` keeps the editor in step: `load` gives the
editor one node per block (raw HTML as a read-only `VerbatimBlock`
carrying its own source), `emit` finds the run of top-level nodes that
changed by identity, serializes just that run, and splices it into
those blocks' lines. A count mismatch after the splice falls back to
whole-document serialization rather than risk a wrong splice; tests
assert the mode. `editorExtensions.ts` holds the one extension list
(editor, print, and the parity test all use it) and the settings chosen
to narrow what an edited block loses: `linkify` and `autolink` off, a
Code mark that doesn't exclude the anchor and bold marks,
`CodeBlockAnchor` sizing its fence to the content. Front matter is split
off before the body reaches the editor and put back on every edit
(`src/format/frontmatter.ts`). `markers-display.ts` only rewrites
markers the scanner recognises, so a marker quoted in a code fence is
left alone.

1. `EditorPane` captures the Tiptap selection through `RenderedViewHandle`.
   `classifyCodeSelection` decides how it can be anchored:
   - **inline** — a normal span (may include inline code);
   - **block** — the selection is inside a fenced code block, so the anchor is
     snapped to the whole block (`CodeBlockAnchor`, below);
   - **reject** — wholly inside inline code or straddling a code-block
     boundary; the user gets a message instead of a silent no-op.
2. If the selection overlaps an existing anchor (`bestOverlappingAnchorId`, or a
   code block that already carries one), `OverlapPrompt` offers to attach the
   note as a **reply** instead — the format cannot represent overlapping
   anchors, so they are prevented at creation time.
3. `RenderedView.applyAnchor` applies the anchor: an inline `AnchorMark` for
   spans, or a `codeBlock` node `anchorId` attribute for whole blocks.
4. Markdown emitted by Tiptap is converted back to `<!-- fmc:N -->` markers
   (`bodyFromAnchorSpans`). `coalesceAnchorMarkers` collapses any same-id run
   Tiptap emits across inline formatting down to a single pair, so a comment
   spanning `*emphasis*`/`[links]()` stays one marker pair.
5. The reducer adds a new `Comment` record and focuses its card.

**Whole code block anchors.** Markers can't live inside a fence, so a code-block
comment is stored as a marker pair on its own lines _around_ the fence
(`<!-- fmc:N -->` / `<!-- /fmc:N -->`). To survive the markdown ⇄ editor
round-trip the anchor rides on the `codeBlock` node: `CodeBlockAnchor`
(`src/components/CodeBlockAnchor.ts`) adds an `anchorId` attribute, serializes
it to the marker form, and reads it back via the fence info string that
`blockAnchorsToInfoString` injects on display. The `data-anchor-id` on the
`<pre>` reuses the same click/hover/focus wiring as inline anchors.

**Undo isolation.** ProseMirror's history lives inside the Tiptap instance, not
in `DocumentState`, so the only way to discard it is to remount the editor.
`RenderedView` is keyed on `state.loadGeneration`, which is bumped whenever
`body` is replaced by something other than a keystroke — `load`,
`applyExternalChange`, `newUntitled` — but **not** by Save As, which
re-dispatches `load` with `rebindOnly` purely to pick up the new path and must
keep the user's history. Without this, ⌘Z walks backwards into content the
document no longer has.

**Subscript / superscript.** `RenderedView` registers Subscript/Superscript
marks with an explicit markdown serialize spec, so `<sub>`/`<sup>` render and
round-trip losslessly instead of flattening to plain text.

Accepting or rejecting a suggestion:

- Accept replaces the text inside the marker pair with `suggested_edit.to`,
  removes the marker pair, and deletes the comment.
- Reject strips the marker pair, preserves the original anchored text, and
  deletes the comment.
- If the current anchored text no longer matches `suggested_edit.from`, the UI
  currently surfaces an error instead of guessing.

Lost anchors:

- Tolerant parsing keeps non-floating comments even when their marker pair is
  missing.
- `classifyAnchors` marks comments as attached, orphaned, or floating.
- `ReattachModal` can insert a fresh marker pair, convert the comment to a
  floating note, or discard it.

Fail-soft recovery:

- Strict `parseForgemarkFile` still throws on a corrupt marker layout (the
  round-trip guarantee is unchanged), but on file open `recoverForgemarkFile`
  salvages what it can instead of blanking every comment: it coalesces
  splattered runs, strips markers that are duplicated/unmatched/recordless, and
  keeps the remaining records as reattachable orphans. So a single damaged
  anchor no longer hides all comments.

External file changes:

- `watchMarkdownFile` watches the parent directory to catch atomic saves.
- The watcher reads changed bytes, fingerprints them, and compares against the
  last known baseline.
- Clean in-memory state shows a banner. Dirty state shows an edit-during-open
  modal. Pressing save during a conflict opens the save-conflict modal.

## The agent CLI

A review cycle with an agent editing the files by hand lost its comments
four times, from four causes: a block scalar the app itself emitted with
an indented first line; a duplicate `replies:` key appended to a record
that already had one; a bare colon in an unquoted body; and a second
comments block appended after the first had become unreadable. Each hid
every comment in the file, and three of the four were invisible until a
reviewer opened it. The common cause was agents composing YAML and
placing markers themselves, and nothing checking the result until the
app read it.

`cli/` is the answer: a `forgemark` command built from `src/format` and
bundled by esbuild into `assets/forgemark-skill/scripts/forgemark.mjs`,
one file with no dependencies that any Node 18+ runs. It ships inside the
skill, so an agent that has the skill has the tool, and `SKILL.md` tells
it to use the tool for every read and write. The commands are the things
an agent does in a review: `list` and `show` to read, `comment` (with
`--anchor`, `--selector` for an HTML element, `--floating`, or
`--suggest`), `reply`, `resolve`/`unresolve`, `float`, `reattach`,
`delete`, and `lint`.

Rules the CLI keeps, all of them tested:

- **Nothing is written that would not read back.** Every write goes
  parse → mutate → serialize → parse the result as the app will → atomic
  write (temp file plus rename, which the app's directory watcher sees
  as one change). A file the app could not read cleanly is refused with
  the parser's message and a pointer to `lint`; the alternative,
  writing back a recovered approximation, would silently change a
  reviewer's file.
- **Anchors are placed by phrase, not offset.** `anchor.ts` matches the
  quoted passage against the source with whitespace collapsed (across
  hard wraps), then case-insensitively, then tolerating inline markup
  between words. An ambiguous phrase is refused with the occurrences
  listed; `--occurrence N` picks one. A match touching inline code widens
  to the code span, one inside a fence snaps to the whole block with
  own-line markers, one that straddles a fence is refused, and one that
  overlaps an existing pair is refused with "reply to that comment
  instead" — the same rule the app enforces at creation. HTML matches
  run over the rendered text map and map back to exact source offsets.
- **`anchor_text` is the rendered text.** `src/format/anchor-text.ts`
  states the normalisation once (Markdown markup stripped, HTML tags
  stripped and entities decoded, whitespace collapsed) so the CLI writes
  what the app writes and `lint` can tell drift from formatting.
- **`lint` reports; it does not repair.** Errors are what the app would
  refuse or misread (an unreadable block with its file line and record
  id, a second block, colliding ids, unmatched or recordless markers,
  overlapping pairs, a floating note that still has markers). Warnings
  are what the reviewer would rather not meet (an orphan, a drifted
  `anchor_text`, a malformed timestamp). Repair was considered and
  dropped: with the tool doing the writes, the remaining ways to break a
  file are prose edits around markers, which the app already recovers
  from on open and which the agent settles with `reattach` or `float`.

The write-side guards the review exposed live in the format layer, so
the app gets them too: the emitter double-quotes a multi-line string
whose first line begins with a space rather than emitting a block
literal the parser can't read; `serializeForgemarkFile` parses its own
block back before returning and refuses when the body still holds a
`<!-- forgemark-comments` line the open path could not read (which is
exactly how the second block was produced); and a YAML parse error
carries the file line and the comment id it falls in, which the app's
banner now shows instead of "couldn't be parsed (yaml)".

The bundle is a committed build artifact like the skill zip, and stale
the same way. `tests/unit/cli/bundle.test.ts` rebuilds it in memory and
compares bytes, so a change to `cli/` or `src/format` without `npm run
build:cli` fails the suite. `npm run cli -- …` runs it from source.

## Tests

- `tests/unit/format/*`: parser, serializer, marker, escaping, compose,
  suggestions, round-trip, property, and reattach behavior.
- `tests/unit/*`: document reducer, workspace reducer, preferences, file IO,
  conflict fingerprints, tokens, clean export, menu bridge, smoke.
- `tests/unit/cli/*`: anchor placement, the command operations, lint, disk
  I/O failure paths, the command-line surface end to end on temp copies of
  the fixtures (Markdown, HTML element anchors, CRLF), and bundle freshness.
- `tests/integration/save-guard.test.tsx`: the app refuses to save over an
  unreadable comments block (⌘S and auto-save), and a file the CLI wrote
  while the app had it open arrives through the external-change path.
- `tests/unit/format/property.test.ts` fuzzes the emitter with the string
  shapes that once defeated a block literal — leading and trailing spaces,
  tabs, blank lines, no trailing newline or several, carriage returns.
- `tests/integration/*`: AppShell, rendered/source views, composer, sidebar,
  suggestions, lost anchors, file opening, settings, skill download, file
  conflicts, tabs, per-tab editors, background documents, the unsaved-work
  guard, and cold start.
- `tests/perf/end-to-end.test.ts`: large-document performance smoke.
- `tests/e2e/smoke.spec.ts`: Playwright smoke against the dev surface.
- `tests/ai/*`: prompt/expectation cases run by hand with a sub-agent;
  never part of `npm test`.
- `tests/setup.ts` installs one fake Tauri (`tests/utils/tauri-fake.ts`)
  for every test: an in-memory disk whose reads return what was seeded
  or written, an atomic rename, dialogs that answer as told, and
  watchers a test can fire. `tests/utils/harness.tsx` mounts the app.
  Thirty files used to carry identical mocks whose reads returned
  undefined, and five rendered a second `DocumentBindings` next to the
  one `AppShell` mounts, running two save timers against one document.

**Typing tests.** `tests/utils/typing.ts` drives real keystrokes into the
rendered editor. ProseMirror observes its contenteditable through a
MutationObserver rather than listening for synthetic `keydown`, so the faithful
simulation is to mutate the DOM and let the observer see it. Until this existed
nothing in the suite typed anything, and a bug that discarded **every**
keystroke in an empty Untitled document sat behind a fully green run. Reach for
it when touching the editor, the ready gate, or anything that reacts to edits.

Before changing the format layer, run `npm test`. For frontend layout changes,
also run the relevant integration test and inspect the app in a browser or
Tauri window — several bugs in the tabs work were reachable only by driving the
real app, particularly anything crossing into Rust.

## Design tokens

The current production tokens live in `src/theme/tokens.ts`.
`docs/design-tokens.js` is retained only as a compact source snapshot for the
token contract test. The old design handoff, phase plan, proposal, and feedback
documents were removed because they described pre-release decisions rather than
the current code.
