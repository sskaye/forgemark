# Plan: what to take from pull request 8, and how

Date: 2026-09-04. Branch: `feature/obsidian-and-source-editing`. Source: PR 8 by acrothers, fetched locally as `pr-8`, based on a `main` from 21 June that is 84 commits behind.

## What the PR did, and where each part stands

| Feature in the PR | Now on `main` | Plan |
| --- | --- | --- |
| Local images resolved against the document via the asset protocol | Present (`AssetPaths`, asset protocol enabled) | Nothing |
| GitHub callouts, the five kinds | Present (`AlertBlockquote`) | Nothing |
| Highlighted code (lowlight), inline and block KaTeX | Present | Nothing |
| One extension factory shared by the rendered and print views | Present (`renderedExtensions`) | Nothing |
| Deleting a selected equation with Backspace or Delete, with an outline | Present | Nothing |
| Obsidian callout types beyond the five, with the `+`/`-` fold marker | Absent | **Item 1** |
| Obsidian image embeds `![[file.png]]` and `![[file\|alias]]`, written back as written | Absent | **Item 2** |
| An input rule turning typed `![alt](path)` into a figure | Absent | Not taking it: with block splicing, typed Markdown becomes real when the block is rewritten, and a rule that fires mid-typing surprises more than it helps |
| An editable Source view | Absent (Source is read-only) | **Item 3**, with a different design |

The PR itself cannot be merged: nearly every file it touches has been rewritten since. It is closed once items 1 to 3 are in, with a note that says which parts landed and where.

## Item 1. Obsidian callout types

**What.** `> [!Takeaway]`, `> [!Executive Summary]-`, any `[!Type]` on the first line of a quote, with an optional `+` or `-` fold marker after the bracket. The five GitHub kinds keep their colour and label; any other type gets a neutral rail and its own text as the label, capitalised as written.

**How.**

- `src/format/markdownExtras.ts`: widen the alert rule from the five names to any non-empty type, and capture the fold marker. The rule stays where it is, shared by the block splitter and the editor, so block boundaries cannot disagree.
- `AlertBlockquote`: the `alert` attribute becomes the type as written; a second attribute keeps the fold marker. Rendering lower-cases the five known kinds for the existing CSS and uses `generic` for the rest, with `data-alert-label` carrying the label. Serialization writes `[!Type]` with the original casing and the fold marker back, so an edit inside the quote changes nothing on the first line.
- CSS: one neutral rule for `data-alert="generic"`.

**Tests.**

- `tests/unit/gfm-extras.test.ts`: an arbitrary type renders with its label and the generic style; the fold marker survives an edit; the five kinds are unchanged.
- `tests/unit/editor-roundtrip.test.ts`: `> [!Takeaway]+` in the byte-identical list.
- `tests/unit/format/blocks.test.ts`: a folded callout is one block.
- The showcase example gains an Obsidian callout; the Markdown browser spec checks it renders.

## Item 2. Obsidian image embeds

**What.** `![[diagram.png]]` and `![[diagram.png|Caption]]` render as images; other embeds (`![[note]]`, `![[paper.pdf]]`) stay as text. The file keeps the wikilink form: an edited paragraph writes `![[…]]` back, never `![](…)`.

**How.**

- `src/format/markdownExtras.ts`: an inline rule for `![[target]]` and `![[target|alias]]` whose target ends in an image extension, rendering `<img src="target" alt="alias" data-wikilink="true" data-wikitarget="target">`. Shared, so the splitter sees the same inline (it changes no block boundary, but one plugin is one place to look).
- `InlineImage`: two attributes, `wikilink` and `wikitarget`; the serializer writes `![[target]]` or `![[target|alt]]` when `wikilink` is set, else the Markdown form as today.
- Resolution: `AssetPaths` already resolves a relative `src` against the document's folder, so `![[diagram.png]]` beside the document just works. Obsidian also finds a bare filename anywhere in the vault; that needs a directory search the app does not do, and is left out. An embed that does not resolve shows the browser's broken-image state, as any missing image does.

**Tests.**

- `tests/unit/inline-html.test.ts` or a new `obsidian.test.ts`: both forms render as images with the right `alt`; a note embed stays text; an edit writes the wikilink form back; the resolved `src` is an asset URL against the folder.
- `tests/unit/editor-roundtrip.test.ts`: both forms in the byte-identical list.
- The showcase example gains an embed next to its existing image; the browser spec checks its `src`.

## Item 3. An editable Source view

**What.** In Source view, a writable document's text can be edited directly, Markdown and HTML alike. For an HTML report this is the only way to edit at all. Commenting stays a Rendered-view action.

**Design, and why it differs from the PR.** The PR re-parses the whole file on every keystroke and replaces body and comments with the result. Under autosave that puts half-typed markers and half-typed YAML on disk as the parser's *interpretation* of them, which can move or drop a comment the user was in the middle of typing. The design here keeps the user's text authoritative while they type:

- **A source draft in state.** While Source view is active and editable, the document holds `sourceDraft: string | null`, the exact text in the editor. `dirty` is set on the first change. Saving while a draft exists writes the draft verbatim, the way any text editor would; it does not re-serialize.
- **Derived view for the sidebar.** On each change (debounced a little), the draft is parsed tolerantly to refresh `body` and `comments` for the sidebar and the anchor statuses, but those derived values are display-only while the draft exists; nothing is written from them.
- **Leaving Source view commits the draft.** On switching to Rendered, or on close or quit, the draft is parsed for real. A clean parse becomes the document (`load`-style, bumping `loadGeneration` so the rendered editor and the report frame start fresh, which is what happens on a reload from disk today). A parse that fails keeps the user in Source view with the existing comments-block banner pointing at the line, rather than silently discarding the comments block; the file on disk holds their text meanwhile.
- **External changes while a draft exists** go through the existing conflict path: the file watcher already compares the disk against the last write, and a draft is just another unsaved change.
- **The read-only case** (a file the app cannot write) keeps the read-only chip and a non-editable view, exactly as today.
- **CodeMirror wiring** follows the PR: an editable compartment, an update listener that emits the text, and a guard so text pushed in from outside does not echo back out or move the caret while the view is focused.

**Tests.**

- `tests/unit/document.test.ts`: `editSource` sets the draft and dirty; a no-op edit does not; `commitSource` with a clean parse replaces body and comments and bumps `loadGeneration`; a failing parse keeps the draft and records the error.
- `tests/integration/source-view.test.tsx`: typing flows out through `onChange`; a text prop change while unfocused replaces the document, while focused it does not; the read-only facet follows the prop.
- `tests/integration/save-state-machine.test.tsx` and `save-guard.test.tsx`: a save with a draft writes the draft byte for byte; autosave the same; the pre-write disk check still refuses to overwrite a newer file.
- `tests/integration/editing-after-transitions.test.tsx`: type in Source, switch to Rendered, and the rendered view shows the edit and the sidebar the comments; add a marker pair by hand in Source and it becomes an anchor on the way back; delete a comment record in Source and its card goes; switch with a broken comments block and the banner appears.
- HTML: edit a report's markup in Source, switch back, and the frame reloads with the change and the comments intact.
- Browser (`tests/e2e/markdown.spec.ts`): the full loop against the showcase, checking the saved file is the typed text.
- The lossless tests stay untouched and must stay green: rendered-view editing does not change.

## Order and checks

1. Item 1, one commit. 2. Item 2, one commit. 3. Item 3 in three commits: the reducer and save path, the Source view wiring, the transitions. 4. Docs: CHANGELOG, ARCHITECTURE (Source view section, Obsidian in the "beyond GFM" section), the skill's note that files may carry Obsidian syntax.

Before every commit: `npx tsc`, `npx eslint .`, `npm run format:check`, `npx vitest run`, and `npx playwright test` for anything the browser can see. Before the pull request: `cargo test`, `npm run build:skill`, and `npm run build`. The manual test script gains a Source-editing section.

## After the merge

Close PR 8 with a comment: which parts landed since June and where, which parts this branch adds, and that the image input rule was left out on purpose.
