# Multi-document (tabs) — build plan

> **Temporary working document.** Written for the `dev_multiple_files` build.
> Delete when the work lands — `docs/` intentionally holds only current
> architecture, not proposals (see the note at the end of `ARCHITECTURE.md`).

**Goal:** allow several Forgemark documents to be open at once. Today,
opening a file replaces whatever is open (`load` in `state/document.ts:239`).

**Decision:** in-window **tabs**. Not multiple windows. Tabs only — no
tabs-plus-windows hybrid.

---

## 1. Why tabs, not windows

Multi-window is superficially attractive: each Tauri webview gets its own
JS module scope, so per-window module state and `window`-level listeners
would isolate for free. But the Tauri shell imposes four concrete costs:

1. **`src-tauri/capabilities/default.json:5` scopes permissions to
   `"windows": ["main"]`.** Any dynamically-created window gets no fs or
   dialog permission. Fails silently and confusingly.
2. **`PendingFiles` (`src-tauri/src/lib.rs:28-35`) drains destructively**
   via `std::mem::take`. The first window to mount claims every queued
   path, including ones intended for other windows.
3. **`RunEvent::Opened` (`lib.rs:78-92`) and the menu handler
   (`lib.rs:56-59`) both use app-global `emit`.** Every window would open
   the same file; ⌘S would save every document. Fixing this means
   `emit_to(focused_label, …)` plus window-label bookkeeping throughout.
4. **Each window is a whole second React app**, duplicating app memory on
   top of document memory.

Tabs avoid all four: one window, one React tree, one menu target. "Which
document" becomes an in-app concept we control.

---

## 2. What makes this tractable

Verified during investigation:

- **`DocumentState` (`state/document.ts:24-61`) is a flat, per-document
  record.** No cross-document assumptions in the shape. `reduceDocument`
  is pure.
- **`services/fileIO.ts` has zero module-level state.** Every function
  takes its path as an argument. No "current path" variable.
- **`services/fileWatcher.ts` is a factory, not a singleton.** All state
  is closed over in locals; returns `{ dispose }`.
- **`services/conflict.ts` is entirely pure** (fingerprint / compare).

The file layer needs essentially no change. Coupling is concentrated in
three places: the React context shape, global `window` event listeners,
and the Rust/menu bridge.

---

## 3. Pre-existing bugs found (Phase 0)

These are live defects independent of tabs. Fix first, as standalone
commits.

### 3.1 Undo history leaks across documents — **data integrity**

The Tiptap editor is never remounted on file open:

- `components/EditorPane.tsx:480` renders `<RenderedView>` with **no `key`**.
- `components/RenderedView.tsx:238-249` swaps content via
  `editor.commands.setContent(...)` instead of recreating the editor.
- `RenderedView.tsx:165` is `StarterKit.configure({ link: false,
codeBlock: false })`. Confirmed in `@tiptap/starter-kit@3.22.5`
  (`dist/index.d.ts:70-72`) that `undoRedo` ships enabled by default and
  is not disabled here.

**Consequence:** the ProseMirror undo stack survives a file open. After
⌘O, ⌘Z can undo backwards into the _previous_ document's content — in an
app whose core guarantee is byte-faithful round-tripping of review data.

**Fix:** remount the editor whenever content is replaced by something
other than a user keystroke. Add a `loadGeneration: number` to
`DocumentState`, incremented by `load` and `applyExternalChange`, and use
it as `key={loadGeneration}` on `RenderedView`.

_Why not `key={docId}`_ (the obvious first answer, and wrong twice over):

- **It can't ship in Phase 0.** Before tabs exist there is exactly one
  document and no doc id to change, so the key would be constant and fix
  nothing. Phase 0 must stand alone.
- **It stays wrong after Phase 1.** `docId` is stable for the life of a
  tab, but a tab's content can be replaced underneath it. Reload-from-disk
  (`applyExternalChange`) must clear undo — otherwise ⌘Z reverts to
  pre-reload content — and `docId` doesn't change, so it wouldn't.
  Conversely Save As re-dispatches `load` with identical content and a new
  path (`DocumentBindings.tsx:167-175`), where undo _should_ survive.

`loadGeneration` gets both right if Save As is excluded from the
increment — worth a dedicated test, since these two paths share the `load`
action and differ only in intent.

### 3.2 Unsaved work discarded without prompt — narrow but real

Autosave exists (`state/DocumentBindings.tsx:258-284`): 500ms debounce
after the last edit. Four guards at `:259-262`:

```ts
if (!state.dirty) return;
if (!state.filePath) return; // Untitled NEVER autosaves
if (state.readOnly) return;
if (state.externalChange != null) return; // blocked while a conflict is pending
```

Current prompt coverage:

| Path                | Dirty prompt?                                                                                                              | Location                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| File > Close        | **Yes** — discard-only, no "Save" option                                                                                   | `AppShell.tsx:140-148`         |
| ⌘N                  | **No** — no dirty check at all                                                                                             | `DocumentBindings.tsx:246-249` |
| ⌘O                  | **No** — dispatches `load` over the open doc                                                                               | `DocumentBindings.tsx:213`     |
| Native window close | No `CloseRequested` handler in `lib.rs`; only `beforeunload`, acknowledged as a stand-in at `DocumentBindings.tsx:301-305` | `:306-315`                     |

Because autosave covers the common case, a **saved** document is dirty
only for the ~500ms since the last keystroke pause — ⌘N/⌘O lose almost
nothing. The genuinely exposed cases are the two where autosave never
runs:

1. **Untitled documents** (no `filePath`) — all work lost on ⌘N/⌘O,
   silently, regardless of how long it was worked on.
2. **Conflict pending** (`externalChange != null`) — autosave blocked
   indefinitely, so the document stays dirty as long as the banner is up.

**Fix — implemented.** `guardDiscard` in `DocumentBindings` now gates
⌘N, ⌘O, Open Recent, and File > Close.

The shape of it follows from the product being auto-save-first:
prompting to save a document that auto-save would have written 500ms
later is incoherent. So the rule is **save it for them when we can, ask
only when we can't**:

| Situation               | Behavior                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Clean, or read-only     | proceed immediately                                                                                                            |
| Dirty, has a path       | save silently, then proceed — no prompt                                                                                        |
| Dirty, Untitled         | prompt: Save As… / Don't Save / Cancel                                                                                         |
| Dirty, conflict pending | prompt: Don't Save / Cancel (**no Save** — saving would clobber the disk copy; that decision belongs to the conflict surfaces) |

Cancelling the Save As location dialog cancels the whole action rather
than falling through to a discard.

`close-file` moved out of `AppShell` into `DocumentBindings` so it shares
this guard instead of carrying its own two-button `ask()`.

**Quit paths — also implemented.** Rust intercepts both doorways and
defers the decision to the frontend, since only it knows whether there
is unsaved work:

- `WindowEvent::CloseRequested` (red button / ⌘W) → `api.prevent_close()`
- `RunEvent::ExitRequested` (⌘Q / Quit menu) → `api.prevent_exit()`

Both emit `forgemark:close-requested`; `menuBridge` re-dispatches it as a
DOM event so the decision stays in `DocumentBindings` and is testable
without a Tauri runtime. Once the guard is satisfied the frontend invokes
`approve_exit`, which sets an `ExitApproved` flag and calls `app.exit(0)`.

The flag matters: without it `app.exit` re-enters `ExitRequested`, gets
prevented again, and the app can never actually quit.

⌘Q had to be handled alongside window-close — it takes a different path
in Tauri, so covering only `CloseRequested` would have left the same bug
in the more common doorway.

`beforeunload` is kept, now scoped to the plain-browser dev surface
(`npm run vite:dev`) where there's no Tauri runtime to intercept.

All of this matters more under tabs — closing a tab is casual and
frequent, and untitled tabs will accumulate.

---

## 4. Phased plan

### Phase 1 — Workspace layer (load-bearing) — **implemented**

Landed as `src/state/workspace.ts` plus a rewritten `DocumentProvider`.
`reduceDocument` is untouched, and all 386 pre-existing tests passed
without modification — the compatibility goal held.

Shipped shape (slightly beyond the sketch below): `nextDocId` is a
counter rather than a random/time-based id, so reducer behavior stays
deterministic; `activeDocument`, `anyDirty`, and `findByPath` are
exported selectors; and `useWorkspace()` exposes `dispatchTo(docId)` for
Phase 2, where background documents need to run their own auto-save and
watcher.

The §4a semantics are in the reducer already: path dedupe on `openTab`,
`Untitled N` numbering with lowest-free reuse, and closing the last tab
leaving a fresh Untitled one.

Still single-document from the user's point of view — no tab chrome yet.

Leave `reduceDocument` **completely untouched**. Add above it:

```ts
type DocId = string;
type WorkspaceState = {
  docs: Record<DocId, DocumentState>;
  order: DocId[]; // tab order
  activeId: DocId;
};
```

`reduceWorkspace` routes each action to `docs[action.docId ?? activeId]`
and handles only new tab-level actions: `openTab`, `closeTab`,
`activateTab`, `reorderTab`.

**Key constraint — `useDocument()` keeps its exact current signature,**
returning the active document's `{state, dispatch, setBody, setViewMode}`.
This is what keeps the change tractable: 13 integration tests mount
`DocumentProvider`, and `Sidebar` / `EditorPane` / the whole format layer
consume the bare `useDocument()` with no document id.

**The compatibility seam is `DocumentProvider`'s props, not just the
hook.** It currently accepts `initialState?: Partial<DocumentState>`
(`DocumentProvider.tsx:22-26`) and tests rely on it — e.g.
`app-shell.test.tsx:32-38` passes `{fileName, body, comments,
originalText}`. The workspace provider must keep accepting that exact
prop and seed a single-tab workspace from it. Preserve both the hook
signature and this prop and the existing suite should be unaffected;
that is the design goal, and it is worth verifying early rather than
assuming, since it is the main thing keeping this change small.
`document.test.ts` tests the pure reducer directly and is unaffected
regardless.

### Phase 2 — Per-document side effects — **implemented**

`DocumentBindings` now takes an optional `docId` (omitted still means
"the active document", so the four tests that render it bare are
unaffected). `AppShell` mounts one instance per entry in
`workspace.order`.

The two halves are in tension and each is now pinned by a test that fails
without it:

- **Per-document:** auto-save, the baseline fingerprint, and the file
  watcher run for _every_ open document. Revert to a single bindings
  instance and edits to a background tab are never written to disk.
- **App-wide:** the `window` listeners (shortcuts, `forgemark:menu`,
  `forgemark:open-path`, quit) are gated on `isActive`. Remove the gate
  and ⌘S saves twice while ⌘N wipes the background document too.

`beforeunload` now consults `anyDirty(workspace)` rather than the active
document alone.

Still no tab chrome — nothing calls `openTab` outside tests yet, so the
app remains single-document from the outside.

#### Original notes

`DocumentBindings` is headless (renders no DOM), so render one per open
document, scoped to its `docId`. Its watcher effect is already keyed on
`state.filePath` (`DocumentBindings.tsx:320-370`) and `baselineRef` is
already per-instance, so both scale naturally.

> **Mount `DocumentBindings` for _every_ open document, always — never
> tie it to editor mounting.** It owns autosave (`:258-284`) and the
> external-change watcher (`:317-370`). A background tab whose bindings
> are unmounted silently stops autosaving and stops noticing that its file
> changed on disk. "Document is open" and "editor is mounted" are separate
> lifecycles and must stay that way. This is cheap: bindings render no DOM
> and hold no ProseMirror state.

_Known redundancy, not a blocker:_ the watcher watches the **parent
directory** (to catch atomic saves), so two documents in the same folder
each register a watch on that folder and each wakes on the other's saves
before filtering by basename. Correct, just duplicated work. Add a
path-keyed registry with refcounting only if profiling shows it matters.

### Phase 3 — Tab bar UI — **implemented**

`TabBar` sits between `TitleBar` and `ErrorBanner`, and hides itself
entirely while one document is open so the app stays as quiet as it was.
Manually verified in a real window.

Tabs made three semantics change, beyond the strip itself:

- **⌘N / ⌘O no longer discard anything**, so they no longer prompt — they
  open tabs. The guard didn't go away, it moved to the two actions that
  now genuinely destroy work: closing a tab and quitting. `PendingIntent`
  shrank from four cases to two.
- **Opening a file onto an untouched Untitled tab reuses it** instead of
  leaving an empty tab behind. File opens only; a bare ⌘N on an empty tab
  still gives you a second one, or the shortcut looks broken.
- **Quit walks the tabs.** Each document's file IO lives in its own
  bindings instance, so the active one can't save another. It finds the
  first unsaved document, brings it forward, asks, then re-enters for the
  next. Note "Don't Save" during a quit **closes that tab**: the document
  stays dirty otherwise, so the walk would find it again and ask forever.
  That's what makes the loop converge.

Six pre-existing tests asserted the old ⌘N/⌘O prompt behavior. They were
rewritten rather than deleted, moving each assertion to where the
protection now lives. One became stronger: ⌘N must open exactly _one_
tab, which fails loudly if the `isActive` gate regresses.

**Known limitation, addressed in Phase 4:** `AppShell` still renders a
single `EditorPane` for the active document, so switching tabs remounts
the editor. Content and dirty state survive (they're in the reducer) but
per-tab undo history, cursor, and scroll do not.

#### Original notes

`.fm-app-shell` is already a vertical flex stack with fixed-height chrome
on top, so `<TabBar />` between `TitleBar` and `ErrorBanner`
(`AppShell.tsx:198`) slots in with `flex-shrink: 0` and no layout
surgery. `.fm-app-body` keeps `flex: 1; min-height: 0`.

Place it **below** the title bar, not inside it:

- `.fm-titlebar-title` is `position: absolute; inset: 0; pointer-events:
none` — hostile to inline growth.
- The title bar already contains a `role="tablist"` segmented control for
  Rendered/Source (`TitleBar.tsx:80`). Two tablists in one bar is an
  accessibility and visual ambiguity worth avoiding.

### Phase 4 — Editor mounting policy — **implemented**

`AppShell` renders one `EditorPane` per open document. Inactive panes
stay mounted but are `hidden` + `display: none`, so per-tab undo history,
cursor, and scroll survive a switch — the ProseMirror history plugin
lives inside the editor instance, so unmounting discards it.

`EditorPane` took a `docId` (omitted still means the active document) and
now classifies its own anchors. Its window listeners — the ⌘F/⌘G/⌘E/⌘⌥M
shortcuts, `forgemark:menu`, and `forgemark:capture-view-sync` — are
gated on `isActive`. Both halves are pinned by tests: mounting only the
active pane loses undo across a switch, and removing the gate opens two
find bars.

Scroll is tracked continuously via `onScroll` into a ref and restored on
the way back in, rather than captured at the switch: `display: none`
drops `scrollTop`, and reading it during the transition races the DOM
update.

**Memory question settled with measurement** (jsdom, so indicative):

| Document  | Tabs | Mount time | Heap delta       |
| --------- | ---- | ---------- | ---------------- |
| 30k words | 1    | 53 ms      | ~0               |
| 30k words | 4    | 189 ms     | +36 MB           |
| 30k words | 8    | 382 ms     | GC ran, unusable |
| 5k words  | 8    | 93 ms      | +13 MB           |

Roughly linear: ~9 MB and ~48 ms per mounted 30k-word editor, ~1.6 MB
each at a realistic 5k words. The cost is paid at **open** time, not at
switch time, which is the point. Eight worst-case documents land around
70 MB — acceptable for a desktop app, and the LRU dropped during review
stays unnecessary. Heap figures are noisy (negative deltas mean GC ran);
mount time is the trustworthy signal.

#### Original notes

The real tradeoff. `RenderedView` builds a ProseMirror schema with 16
extensions and renders the whole document — **ProseMirror has no
virtualization**, so DOM cost is O(document length). The perf fixture
(`tests/perf/end-to-end.test.ts`) targets **30,000-word documents with 50
comments**, so N mounted editors is a genuine memory concern.

- _Mount all N_ → fast switching, per-tab undo preserved, but N× memory
  and N copies of the global `window` keydown / `forgemark:menu`
  listeners in `AppShell`, `EditorPane`, and `Sidebar` all firing per
  keystroke.
- _Mount only active_ → clean listeners, but each switch pays a full
  re-parse and loses cursor, scroll, and undo.

**Chosen policy: mount every open document's editor; hide inactive ones
with `display: none`; gate every global listener on `isActive`.**

An earlier draft of this plan specified an LRU (active + ~3 recent, evict
beyond). Dropping it, for three reasons:

1. **It makes undo non-deterministic.** Some tabs would keep their undo
   stack and others wouldn't, depending on invisible eviction order. "Why
   did ⌘Z stop working on this tab?" is a worse experience than a uniform
   rule, in either direction.
2. **It buys an unmeasured win.** The N× memory concern is a projection
   from the 30k-word perf fixture, not an observation. Real sessions are
   more like 3–8 tabs, most of them far smaller.
3. **It adds a whole subsystem** — eviction policy, state capture on
   evict, rehydration on return — to a plan whose main risk is already
   breadth.

So: mount all, measure at realistic tab counts, and add eviction **only**
if profiling demands it. If it ever does, the seam is a single component
boundary, so retrofitting is cheap.

Note that `isActive` gating of the global listeners is required either
way — it's forced by having N mounted `EditorPane`s, not by the mounting
policy.

Scroll restoration largely falls out for free — `services/viewSync.ts` +
`captureViewportAnchor` already solve this for rendered↔source toggles;
reuse for tab switches. Two gotchas:

- **Capture the viewport anchor _before_ hiding.** ProseMirror's
  `coordsAtPos` / `posAtCoords` return garbage under `display: none`
  (`RenderedView.tsx:444-472`).
- **Respect the `editorReadyRef` microtask handshake**
  (`RenderedView.tsx:246`), which swallows updates during mount. On
  remount it starts `false` and flips via `queueMicrotask`.

### Phase 5 — Native shell / menu routing — **implemented**

- **Tab navigation: built, then removed.** ⌘⇧] / ⌘⇧[ plus Window-menu
  items worked, but switching tabs is a click on a strip that's already
  on screen — the shortcut and menu entries earned nothing. Removed
  along with the `cycleTab` action rather than left as dead code.
- **Multi-select open.** `openMarkdownFiles` replaces the `multiple:
false` dialog; each file becomes a tab. Reads are sequential — parallel
  buys nothing perceptible and makes failures messier — and unreadable
  files are skipped rather than sinking the whole batch.
- **`close-file` → close tab.** Already done in Phase 3.

**Correction to this document.** Earlier revisions claimed
`windowActions.ts` had a latent bug in `window-center`, "working only by
accident of assignment order". **That was wrong.** `previousGeometry` is
assigned the _current_ geometry immediately above, so reading `.w/.h`
from it returns the current size — exactly what "keep current size,
centre it" wants. The code was correct; one variable was just serving two
meanings. Phase 5 introduces a `current` local and reads that, which is a
readability change, not a fix.

Likewise `previousGeometry` stays at module scope: it's a property of the
window, Forgemark is single-window by decision (§1), and it is
deliberately not something a tab owns.

**Deliberately not done: the native Window-menu document list.** It would
have to be rebuilt from Rust on every tab open, close, and rename, and it
duplicates the tab strip that's already on screen. The same reasoning
later removed the navigation commands, so the Window menu is unchanged
from before tabs.

#### Original notes

- `close-file` currently dispatches `newUntitled` (`AppShell.tsx:149`) —
  should close a tab.
- Add ⌘⇧[ / ⌘⇧] tab switching and a Window-menu document list
  (`lib.rs:270-277` has only minimize/maximize/resize today).
- Relax `fileIO.ts:25`'s `multiple: false` to open several files at once.
- Move `previousGeometry` out of module scope (`windowActions.ts:31`).
  Under tabs it is shared app-wide, which is fine — but note the **latent
  bug**: `window-center` (`:78-81`) reads `previousGeometry.w/h`
  immediately after overwriting it at `:50-55`, and works only by
  accident of assignment order.

### Phase 6 — Session restore — **implemented**

`state/session.ts` stores `{ paths, activeIndex }` under
`forgemark.session`.

**Only documents with a path are remembered.** Persisting unsaved
Untitled buffers would mean putting document _content_ into
localStorage — size limits, a second copy of review data living outside
the markdown, and staleness against the real file. The unsaved-work
guard already forces those buffers to be saved or explicitly discarded
before the app can quit, so nothing is lost by leaving them out.

Paths are stored rather than contents, so a file edited outside Forgemark
comes back current instead of stale.

**Where the "once" lives matters.** The first attempt put restore in
`DocumentBindings` behind a `restoredRef` — which re-fired on every new
tab, because those bindings mount once per _document_. `AppShell` mounts
once per _launch_, so it now decides whether to restore and emits
`forgemark:restore-session`; `DocumentBindings` listens and does the
opening, next to the file IO. It also reads the stored session during
first render, before the persist effect can overwrite it with the empty
startup workspace.

Restores are sequential so tab order matches the previous session,
missing files are skipped, and focus is matched by path rather than index
(a skipped file would shift the positions).

`tests/setup.ts` clears the session key between tests — jsdom shares
localStorage across a file, so one test's open documents were being
restored into the next test's app.

#### Original notes

Preferences persist recent files but **nothing records which documents
were open** — reopening always lands on `INITIAL_STATE`. A
`forgemark.openTabs` key is straightforward; cross-window `storage` sync
already exists (`preferences.ts:117-124`). Fully independent of 1-5.

---

## 4a. Semantics the single-document design never had to answer

These have no current behavior to inherit. Decide them in Phase 1, not
during Phase 3 UI work.

### Opening a file that is already open — **correctness, not polish**

Opening a path that another tab already holds must **focus the existing
tab**, not create a second one. Two tabs on one path means two watchers
and two independent 500ms autosave loops writing the same file: they
overwrite each other, and each one's write trips the other's
external-change detection, producing a conflict-banner ping-pong between
two views of the same document.

Dedupe by resolved path in the `openTab` reducer path. Applies to all
four open entry points (⌘O, `openPath`, Finder association, and the
`PendingFiles` drain).

### Closing the last tab

**Leaves an Untitled tab; the window stays open.** Matches TextEdit /
Pages and preserves today's `close-file` behavior (`AppShell.tsx:149`
dispatches `newUntitled`). So `newUntitled` survives Phase 5 — it becomes
"close this tab, and if it was the last one, replace it with an empty
tab."

### Untitled tab naming

`INITIAL_STATE.fileName` is the constant `"Untitled"`
(`document.ts:151`). With one document that was unambiguous; with tabs,
several untitled tabs are indistinguishable. Number them —
`Untitled 2`, `Untitled 3` — allocating the lowest unused index, and free
the index when the tab closes or is saved to a real path.

### Dirty state is now an aggregate

Two consumers currently read the single document's `dirty` and must
switch to "any open tab":

- **`beforeunload`** (`DocumentBindings.tsx:306-315`) and the Phase 0
  `CloseRequested` handler — closing the window must consider every tab,
  not the active one, or unsaved background tabs vanish silently.
- **`document.title`** (`AppShell.tsx:182-185`) — the dirty dot should
  keep following the **active** tab, but per-tab dirty state also needs
  to surface on each tab in the tab strip.

## 5. Smaller items for the build

- **`RenderedView.tsx:503`** has a module-level
  `const searchPluginKey = new PluginKey(...)`. Each editor instance gets
  its own plugin _state_, so N editors should be survivable — but verify
  under multiple mounted editors rather than assuming.
- **`load` hardcodes `viewMode: "rendered"`** (`document.ts:248`) and
  callers then re-dispatch the user's default-view preference as a second
  action (`DocumentBindings.tsx:115-117`, `:225-227`). Per-tab view-mode
  restore must preserve that two-dispatch sequence or tabs will flicker
  to rendered on activation.
- **Per-document state that must move into the per-tab slice:** all of
  `DocumentState`, plus find/replace local state
  (`EditorPane.tsx:38-45`), context-menu position (`:49-52`), and pane
  scroll position (plain DOM `overflow-y`, currently captured nowhere).
- **`sidebarOpen` (`AppShell.tsx:40`) should stay app-global**, but
  `filter` / `sort` / `focusedCommentId` live in `DocumentState` and are
  correctly per-document.
- **`forgemark:capture-view-sync`** is a global `window` CustomEvent with
  no document identity (`AppShell.tsx:52` dispatches, `EditorPane.tsx:373`
  listens). With N mounted panes every listener fires — concrete refactor
  point.
- **`document.title`** (`AppShell.tsx:182-185`) is written from the single
  document; should follow the active tab.

---

## 6. Test impact

46 test files. The Phase 1 design deliberately protects most of them:

- **13 integration tests mount `DocumentProvider`** — unchanged if
  `useDocument()` keeps returning the active document.
- `tests/unit/document.test.ts` and `document-phase6.test.ts` test the
  pure reducer directly — unchanged.
- The entire `tests/unit/format/*` suite is untouched by this work.

New coverage needed:

- `reduceWorkspace` — open / close / activate / reorder, and which tab
  gets focus after closing the active one.
- Opening an already-open path focuses the existing tab instead of
  duplicating it (§4a).
- Closing the last tab leaves an Untitled tab.
- Untitled index allocation and reuse.
- Undo isolation: `loadGeneration` clears history on reload-from-disk but
  preserves it across Save As (§3.1). Worth a test precisely because both
  paths share the `load` action.
- Tab-close dirty guard, including the untitled and conflict-pending
  cases from §3.2.
- Aggregate dirty: window close prompts when a **background** tab is
  dirty.

---

## 7. Open questions

- ~~Memory at realistic tab counts is unmeasured.~~ **Resolved in Phase
  4** — measured at ~9 MB per mounted 30k-word editor, ~1.6 MB at a
  realistic 5k words, paid at open time rather than per switch.
  Mount-all stands; no LRU needed.
- Does the tab strip need overflow handling (scroll vs. shrink-to-fit) in
  v1, or is a hard cap acceptable? Not a blocker for Phases 1-2.
