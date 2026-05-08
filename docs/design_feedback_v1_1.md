# Design Feedback — Forgemark v1.1

Review of the revised handoff in `docs/design_handoff_v1_1/`. Every item from the v1.0 feedback round has been addressed. Six small refinements from the v1.1 additions are below — all are **decided** rather than open; the next design iteration should update the affected mocks to match. Two action items are mine: writing the production sample-file content, and updating the product proposal with the new `floating` schema field.

## What's resolved (acknowledgment)

- ✅ **Tokens reconciled.** `tokens.js` is now the explicit source of truth; README tables match. Spot-checked: anchor focus, editor bg, sidebar bg all align.
- ✅ **Title bar 44px clarified** as combined chrome (28px title strip + 16px toolbar inset).
- ✅ **Editorial pairing commented out** in `tokens.js` with archaeological note. README explicitly says not to wire user-facing controls to it.
- ✅ **Sidebar filter hardcoding flagged** in the State Management section, with the production rule (populate from comment authors + "By me").
- ✅ **Wordmark direction locked** as bracketed pilcrow. Three candidates were shown side-by-side in the canvas (`bracket`, `anchor`, `forge`) before the lock — the right way to present this.
- ✅ **Reject-suggestion now terminal** — README §5 reflects it, `app.jsx`'s `onReject` filters the comment out, matching the proposal §117 spec.
- ✅ **Source view "read-only review" chip** designed and wired (light + dark) with hover tooltip.
- ✅ **Floating-note state** designed end-to-end: schema field (`floating: true`), card variant, sidebar section ("FLOATING NOTES · N"), three-option Reattach modal, action row (Reply / Resolve / Reattach… / Discard).
- ✅ **Three conflict surfaces** designed and themed: file-conflict banner, edit-during-open modal (clean + with-unsaved-work variants), save-conflict modal.
- ✅ **All v1.0 clarifications answered inline** — resolved-card preview strips markdown, reply ordering preserved within threads, Open Recent at 10, skill package bundled at ~30–60 KB, empty-state copy specified.
- ✅ **Round-trip fixture milestone** added as step 3.5 in implementation order, with "Block step 4 on this passing" — exactly what was needed.

## Decisions for the next iteration

Each item below is **resolved** — the next design iteration should update the affected mock or copy to match. None are blocking.

### 1. Save-conflict modal — cap diff detail to what v1 can actually compute

**Decided:** v1 commits to two diff signals only — `+ N comments added/removed` (we own that schema) and `+ N body bytes changed` (cheap to compute). The "+ 1 paragraph rewrite" line in the current mock implies markdown-aware semantic diffing that v1 will not deliver; remove it.

**Next iteration:**

- Update the save-conflict modal to use only the two committed signals.
- Add a second mock variant where one or both columns show **"Unknown changes"** — this will be the common case when the file's been touched but Forgemark can't categorize the delta cleanly.

### 2. "Cancel and inspect" — drop the diff-drawer destination

**Decided:** the button title becomes simply **Cancel** in v1. Clicking it dismisses the save modal and returns the user to the editor with their unsaved work intact + the file-conflict banner re-appearing as a reminder. The user can open the on-disk version in another editor if they want to compare. No diff drawer in v1.

**Rationale:** the original design has the button present "so users have a way out," but a button without a destination is worse than no button. Plain Cancel is honest.

**Next iteration:**

- Rename the primary outlined button in the save-conflict modal to **Cancel**.
- Drop the "out of scope for v1" diff-drawer note from §11c.
- Keep **Overwrite disk version** as the destructive path; that's still correct.

### 3. "Show details" disclosure in edit-during-open modal — cut

**Decided:** the modal is a momentary decision surface. The summary line ("1 open composer, 2 edited cards, 1 unsent reply") is informative enough; users don't need to drill into individual cards to decide between Reload and Keep. If they want detail, they click Keep your version and inspect in the sidebar afterward.

**Next iteration:** remove the disclosure triangle and "Show details" link from `EditDuringOpenModal` (`withUnsavedWork` variant).

### 4. Floating-note card — add Edit to the action row

**Decided:** when the focused floating note was authored by the current user (`comment.author === preferences.authorName`), the action row gets an **Edit** button alongside Reply / Resolve / Reattach… / Discard. Same edit affordance as a regular `<FMCard>`.

**Rationale:** a floating note may need clarification _because_ it's lost its anchor — the body should explain what the note was originally about. Editing is meaningful.

**Next iteration:** update `FloatingNoteCard` action row to include Edit conditionally on `isOwnComment`.

### 5. File-conflict banner — drop the redundant `×` dismiss

**Decided:** the banner shows two actions only — **Keep your version** and **Reload from disk**. Drop the `×` icon. The "local wins on next save" flag is set by the explicit Keep button; no second dismiss path with subtly different semantics.

**Rationale:** the difference between "I'll keep mine for now" and "I'll keep mine, will overwrite on save" is invisible at the affordance level; one button doing one thing is clearer.

**Next iteration:** remove the `×` dismiss button from `FileConflictBanner`.

### 6. Conflict detection plumbing — content hash, mtime as fast-path

**Decided:** detect external changes by **content hash**, with **mtime as a fast-path skip optimization**. If mtime is unchanged since open, skip the hash check entirely (cheap). If mtime has changed, hash both the on-disk file and the in-memory version; fire the conflict only if hashes disagree. Avoids spurious banners from touch-saves and file-system sync events.

**Next iteration:** update §11 / §State Management copy to reflect this rather than "mtime _or_ content hash."

## One question back from design

The README explicitly asks me to write the production sample file (the one shipped with the app, used in first-run onboarding). The shape was specified: 400–600 words, 5 comments (2 human + 2 Claude + 1 suggested-edit), one threaded reply, none resolved.

I'll write this and put it at `docs/sample-onboarding-file.md`, then we can iterate. Calling it out so it doesn't sit on the floor.

## Downstream: proposal needs a `floating` schema update

The product proposal at `docs/markdown-commenter-proposal.md` defines the YAML schema (§102–115) and the Format Spec for AI Authors (§121–137). The new `floating: true` field isn't yet in either. To keep the proposal authoritative and the AI skill package complete, I'll add:

- A new line in the schema reference (§102–115): `floating` (boolean, optional) — when true, the comment has no inline marker pair and `anchor_text` may be absent.
- A note in the Format Spec for AI Authors (§121–137) explaining that an AI agent encountering `floating: true` should _not_ attempt to insert inline markers, and that an AI agent can elect to set this flag if it has authored a comment that has no good anchor (rare but possible).
- A small mention in §52 ("file is the source of truth" pillar copy) that floating notes are a steady-state, not a recovery state.

This is a one-pass edit on my end. Flagging that the design has technically extended the schema, and the proposal — which the AI skill depends on — needs to follow.

## Net

Strong v1.1 handoff. All six refinements above are tightening, not redesign — the next design pass folds them into the affected mocks. No blocks on starting implementation; engineering can pick up the v1.1 handoff today and back-fill the mock updates when the next design pass lands.
