# Forgemark architecture

This is the fast path for future agents and contributors who need to
understand the repository before making changes. The README explains what
Forgemark is; this file explains how the code is put together.

## Product shape

Forgemark is a Tauri desktop app for reviewing Markdown documents. Review data
lives inside the Markdown file itself:

- Inline marker comments wrap anchored passages: `<!-- fmc:N -->...<!-- /fmc:N -->`.
- A trailing `<!-- forgemark-comments ... -->` block stores comment records as
  YAML.
- The AI-facing format spec lives in `assets/forgemark-skill/SKILL.md`.

The app treats the parsed document as two values: `body` and `comments[]`.
Opening a file parses raw Markdown into that shape. Saving serializes the shape
back to a single Markdown file.

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

## Session restore

`src/state/session.ts` persists `{ paths, activeIndex }`; on launch the files
reopen as tabs with the previously active one focused. Only documents **with a
path** are remembered — persisting Untitled buffers would mean putting document
content in localStorage, and the guard above already ensures they're saved or
explicitly discarded first. Paths are stored rather than contents, so a file
edited outside Forgemark comes back current.

`AppShell` decides _whether_ to restore (it mounts once per launch);
`DocumentBindings` does the opening (it has the file IO). That split is
load-bearing: bindings mount once per _document_, so a guard there re-fires on
every new tab.

## Core modules

| Area            | Files                                                                                              | Notes                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model  | `src/state/document.ts`, `src/state/DocumentProvider.tsx`                                          | Pure reducer and context. Keeps file path, raw original text, body, comments, dirty state, composer state, lost-anchor state, conflict state, sidebar controls, and `loadGeneration` (see below).                                     |
| Workspace       | `src/state/workspace.ts`                                                                           | The open documents: `docs`, tab `order`, `activeId`. Routes document actions to one document; owns tab open/close/activate/reorder, path dedupe, and Untitled numbering. Wraps `reduceDocument` untouched.                            |
| Session         | `src/state/session.ts`                                                                             | Persists which files were open (paths, not contents) so a launch can reopen them.                                                                                                                                                     |
| Side effects    | `src/state/DocumentBindings.tsx`                                                                   | Mounted once per OPEN document. Opens/saves files, runs autosave, watches external file changes, consumes pending save requests, and guards unsaved work. Window listeners inside are gated on `isActive`.                            |
| Shell layout    | `src/components/AppShell.tsx`, `src/components/TabBar.tsx`                                         | Assembles the app and hosts modals/banners. Renders one `DocumentBindings` and one `EditorPane` per open document. The tab strip hides itself when only one document is open.                                                         |
| Rendered editor | `src/components/EditorPane.tsx`, `src/components/RenderedView.tsx`, `src/components/AnchorMark.ts` | Rendered view converts Forgemark markers to Tiptap anchor spans and back. New comments and suggestions are created here because this layer has selection access. One pane per open document; inactive ones are hidden, not unmounted. |
| Source view     | `src/components/SourceView.tsx`                                                                    | Read-only CodeMirror view of the exact serialized Markdown, with decorations for markers and the trailing comments block.                                                                                                             |
| Sidebar         | `src/components/Sidebar.tsx`, `src/components/FMCard.tsx`, `src/components/InlineComposer.tsx`     | Thread lifecycle: reply, edit, resolve, delete, accept/reject suggestions, reattach orphaned comments, filter, and sort.                                                                                                              |
| Format layer    | `src/format/*`                                                                                     | Parser, deterministic YAML emitter, serializer, marker scanning/pairing, marker insertion/removal, lost-anchor candidate ranking, clean export, escaping. This is the domain core and is heavily tested.                              |
| File services   | `src/services/fileIO.ts`, `src/services/fileWatcher.ts`, `src/services/conflict.ts`                | Tauri wrappers, parent-directory watcher for atomic saves, and fingerprint comparison for external-change detection.                                                                                                                  |
| Preferences     | `src/state/preferences.ts`                                                                         | LocalStorage-backed author, theme, font size, default view, recent files, and first-run flag.                                                                                                                                         |
| Native shell    | `src-tauri/src/lib.rs`, `src/state/menuBridge.ts`, `src/services/windowActions.ts`                 | Rust builds native menus and file-open events, then emits Tauri events. The frontend routes them into existing command paths.                                                                                                         |
| Skill bundles   | `assets/forgemark-skill/*`, `scripts/build-skill.mjs`, `src/services/skillDownload.ts`             | AI-agent instructions are packaged as both `.skill` and `.zip`; Settings downloads them through the Tauri save dialog.                                                                                                                |

## Important workflows

Opening a file:

1. `DocumentBindings` calls `openMarkdownFiles` (⌘O, multi-select) or
   `readMarkdownFile` (Open Recent, Finder, session restore).
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

## Tests

- `tests/unit/format/*`: parser, serializer, marker, escaping, compose,
  suggestions, round-trip, property, and reattach behavior.
- `tests/unit/*`: document reducer, workspace reducer, preferences, file IO,
  conflict fingerprints, tokens, clean export, menu bridge, smoke.
- `tests/integration/*`: AppShell, rendered/source views, composer, sidebar,
  suggestions, lost anchors, file opening, settings, skill download, file
  conflicts, tabs, per-tab editors, background documents, the unsaved-work
  guard, and session restore.
- `tests/perf/end-to-end.test.ts`: large-document performance smoke.
- `tests/e2e/smoke.spec.ts`: Playwright smoke against the dev surface.
- `tests/ai/*`: optional live-agent fixtures and prompts. These are excluded
  from normal test runs unless `RUN_AI_TESTS=1`.

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
