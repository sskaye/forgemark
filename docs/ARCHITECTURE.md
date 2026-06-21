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
- `DocumentProvider`, which owns the document reducer.
- `AppShell`, which composes the title bar, editor, sidebar, modals, conflict
  surfaces, settings, and first-run welcome.

Most meaningful state changes go through `src/state/document.ts`. Most
side effects live in `src/state/DocumentBindings.tsx`.

## Core modules

| Area            | Files                                                                                              | Notes                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model  | `src/state/document.ts`, `src/state/DocumentProvider.tsx`                                          | Pure reducer and context. Keeps file path, raw original text, body, comments, dirty state, composer state, lost-anchor state, conflict state, and sidebar controls.                                      |
| Side effects    | `src/state/DocumentBindings.tsx`                                                                   | Opens/saves files, runs autosave, handles document shortcuts, watches external file changes, and consumes pending save requests.                                                                         |
| Shell layout    | `src/components/AppShell.tsx`                                                                      | Assembles the app and hosts modals/banners. Recomputes anchor status from body/comments.                                                                                                                 |
| Rendered editor | `src/components/EditorPane.tsx`, `src/components/RenderedView.tsx`, `src/components/AnchorMark.ts` | Rendered view converts Forgemark markers to Tiptap anchor spans and back. New comments and suggestions are created here because this layer has selection access.                                         |
| Source view     | `src/components/SourceView.tsx`                                                                    | Read-only CodeMirror view of the exact serialized Markdown, with decorations for markers and the trailing comments block.                                                                                |
| Sidebar         | `src/components/Sidebar.tsx`, `src/components/FMCard.tsx`, `src/components/InlineComposer.tsx`     | Thread lifecycle: reply, edit, resolve, delete, accept/reject suggestions, reattach orphaned comments, filter, and sort.                                                                                 |
| Format layer    | `src/format/*`                                                                                     | Parser, deterministic YAML emitter, serializer, marker scanning/pairing, marker insertion/removal, lost-anchor candidate ranking, clean export, escaping. This is the domain core and is heavily tested. |
| File services   | `src/services/fileIO.ts`, `src/services/fileWatcher.ts`, `src/services/conflict.ts`                | Tauri wrappers, parent-directory watcher for atomic saves, and fingerprint comparison for external-change detection.                                                                                     |
| Preferences     | `src/state/preferences.ts`                                                                         | LocalStorage-backed author, theme, font size, default view, recent files, and first-run flag.                                                                                                            |
| Native shell    | `src-tauri/src/lib.rs`, `src/state/menuBridge.ts`, `src/services/windowActions.ts`                 | Rust builds native menus and file-open events, then emits Tauri events. The frontend routes them into existing command paths.                                                                            |
| Skill bundles   | `assets/forgemark-skill/*`, `scripts/build-skill.mjs`, `src/services/skillDownload.ts`             | AI-agent instructions are packaged as both `.skill` and `.zip`; Settings downloads them through the Tauri save dialog.                                                                                   |

## Important workflows

Opening a file:

1. `DocumentBindings` calls `openMarkdownFile` or `readMarkdownFile`.
2. `parseForgemarkFile(..., { tolerant: true })` splits body/comments.
3. A `load` action resets document state and records the original bytes.
4. `AppShell` classifies anchors so orphaned comments can be surfaced.

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
- `tests/unit/*`: reducer, preferences, file IO, conflict fingerprints,
  tokens, clean export, menu bridge, smoke.
- `tests/integration/*`: AppShell, rendered/source views, composer, sidebar,
  suggestions, lost anchors, file opening, settings, skill download, and file
  conflicts.
- `tests/perf/end-to-end.test.ts`: large-document performance smoke.
- `tests/e2e/smoke.spec.ts`: Playwright smoke against the dev surface.
- `tests/ai/*`: optional live-agent fixtures and prompts. These are excluded
  from normal test runs unless `RUN_AI_TESTS=1`.

Before changing the format layer, run `npm test`. For frontend layout changes,
also run the relevant integration test and inspect the app in a browser or
Tauri window.

## Design tokens

The current production tokens live in `src/theme/tokens.ts`.
`docs/design-tokens.js` is retained only as a compact source snapshot for the
token contract test. The old design handoff, phase plan, proposal, and feedback
documents were removed because they described pre-release decisions rather than
the current code.
