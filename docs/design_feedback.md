# Design Feedback — Forgemark v1

This is feedback on the handoff in `docs/design_handoff/`. Strong work overall — the throughline ("the file is the document, the UI is a lens on it") is the right framing and shows up consistently. The four pushback items are well-grounded; better surfaced now than discovered during build.

Below: my responses to your pushback, alignment on your answered questions, inconsistencies to clean up before engineering picks this up, and a small set of new design requests.

## Responses to your four pushback items

**1. Source view interaction asymmetry.** Accepted. Read-mostly source view is correct. The pillar ("source view feels like a peer view") doesn't require feature parity — it requires that source view feels like a legitimate way to inspect the file, not a debugging escape hatch. Your source view does that. No change needed; just add a one-line note in the View menu copy or a subtle status hint that selection-to-comment is unavailable in source mode, so users don't try and silently fail.

**2. Format doesn't survive paragraph deletion.** Real issue, needs a product call now. Three paths to consider:

- (a) **Floating-note state** — when no candidates can be found, the comment becomes a sidebar-only note with no inline anchor. Schema gets a `floating: true` flag (or `anchor_text` becomes nullable). The card stays in a "Floating" sidebar section similar to the lost-anchor section.
- (b) **Deletion confirmation** — when about to delete a passage carrying comments (detected on save by diffing against the previous version), prompt: "This deletion will orphan N comments. Discard them? Keep as floating notes? Cancel?"
- (c) **Both** — confirm at deletion *and* support floating notes for the cases where the user accepts the orphaning.

For v1 I'd ship (a). It's the smallest schema change, doesn't require diff-on-save infrastructure, and the existing lost-anchor / Reattach modal flow already implies this state — your modal would just gain a third option **Keep as floating note** alongside Discard and Reattach. Mock this state please.

(b) is worth doing in v1.1 once we see how often this happens in practice.

**3. Brief assumes one document.** Accepted: v1 ships single-document. Reviewers re-use ⌘O and Open Recent. The handoff is correct to flag this — multi-document drawer / project concept goes in v1.1. Confirming explicitly so this doesn't become a v1 discovery.

**4. Edit-during-open is undefined.** Real gap. I'd like a small design pass on this before v1 ships. Specifics:

- File watcher (Tauri) detects external change.
- Banner appears at top of editor pane: "This file was modified outside Forgemark."
- Three actions: **Reload from disk** (filled blue, primary) · **Keep your version** (tertiary; local wins; will overwrite on next save) · **Cancel** (close banner; treat as Keep yours but no save-overwrite warning).
- If the user has an unsaved composer or unsaved edits, the banner copy must call that out specifically and require a click-through, not auto-dismiss.

This is the same modal shape regardless of whether the change came from another human, an AI agent, or a third-party editor. The schema already supports concurrent AI annotation in principle (`author` is just a name); the UI just needs to reconcile two versions of the file.

A symmetric question: **save-conflict** — what happens on ⌘S when the underlying file changed since the user opened it? Same modal, with "Reload" greyed out (would lose local edits) and the choice being **Overwrite** vs **Cancel and inspect**. I'd treat this as a separate-but-related design pass.

## Alignment on your answered questions (Q1–Q5)

All five answers are right. Calling out my agreement so there's no ambiguity:

- **Q1 (right-pinned, not detachable):** yes.
- **Q2 (collapse-in-place):** yes. Reopen rate is the right argument.
- **Q3 (per-document source view, default rendered):** yes.
- **Q4 (body-edit diff skipped):** yes for v1. Add a TODO marker in the codebase so we don't forget when AI-driven edits become more common.
- **Q5 (dashed magenta lost-anchor):** yes, and the rationale (yellow=anchor, green=suggestion, red=alarm, blue=focus, magenta=available) is the right way to think about it.

## Inconsistencies between handoff files

These need a single source of truth before engineering picks this up.

**1. Token values disagree between `README.md` and `tokens.js`.** Examples:

| Token | README.md (light) | tokens.js (light) |
|---|---|---|
| anchor default bg | `rgba(255,200,0,0.42)` | `rgba(255,200,72,0.22)` |
| anchor focus bg | `rgba(255,180,0,0.82)` | `rgba(255,200,72,0.55)` |
| anchor resolved | `rgba(255,200,0,0.18)` | `rgba(0,0,0,0.05)` |
| editor bg | `#ffffff` | `#FCFCFB` |
| sidebar bg | `#f8f7f3` | `#F4F3F0` |

Naming convention also differs (`--fm-anchor-bg` CSS vars in README vs camelCase keys in tokens.js). Pick one source of truth — I'd vote `tokens.js` since the prototype actually consumes it, then regenerate the README table from it. Or keep README authoritative and update `tokens.js`. Either way: identical values, generated from one place.

**2. Title bar height: 28px vs 44px.** README says "Title bar (28px, native on macOS)" but `chrome.jsx` renders `height: 44`. macOS standard for a titlebar with a toolbar row is around 52px; for a titlebar alone it's ~28px. The 44px in the prototype includes the toolbar (segmented control + sidebar toggle). Reconcile: either say "28px title strip + 16px toolbar row" or just "44px combined chrome". The README's "28px" is misleading.

**3. Type pairing: README locks Native, tokens.js still ships both.** The rationale doc says pairing was deprecated as a tweak. `tokens.js` still exports `pairings: { native, editorial }`. Either remove `editorial` from `tokens.js` or keep it commented out as "considered, not shipped." Don't leave it as a live config option that contradicts the locked spec.

**4. Sidebar filter is hardcoded "By Claude" in the prototype.** In `chrome.jsx`, `FMSidebarHeader` has filter options including a literal `{ value: "claude", label: "By Claude" }`. Production needs this to populate from the actual `author` field of comments in the file (a Set of distinct authors plus the user's own name as "By me"). Worth a one-line note in the README so engineering doesn't carry the hardcoded list forward.

## Things missing from the bundle

You called these out as not in the box, but I want to confirm what I expect back:

- **Application icon (.icns / .ico).** Acknowledged not in v1. I'd like to see 2–3 wordmark candidates (the rationale mentions "single bracketed pilcrow" but the bundle has no glyph variants). Even a single candidate would be enough to lock direction.
- **Sample annotated file content.** Onboarding lands the user in "a sample file pre-populated with one human and one AI comment." `sample-doc.jsx` covers the prototype's case but ships with the prototype, not with the real app. Please specify the prose and comments that should ship in production — first-impression matter.
- **Skill package details.** The Settings mock has a "Download .skill" button. Engineering needs to know: what does the package contain? What's the target size? Where is it hosted (bundled in the app vs fetched from a URL)?

## New design requests

1. **Edit-during-open conflict banner / modal** — see Pushback 4 above.
2. **Save-conflict modal** — see Pushback 4 above (related but distinct).
3. **Lost-anchor with no candidates: "Keep as floating note" state** — see Pushback 2 above. This needs a sidebar section design ("Floating notes") and a card variant (no inline highlight, sidebar-only).
4. **Toolbar copy when source view is active** — small one-liner explaining selection-to-comment isn't available, or a tooltip on the disabled affordance.
5. **Wordmark candidates** — even one or two glyph variants.

## Clarifications I'd like back

- **Resolved-card collapsed preview** says "first 60 chars of body." Does this strip markdown formatting? E.g., if the body is `**Bold** and italic`, does the preview show literal asterisks or rendered text? I'd vote rendered.
- **Reply ordering vs. sidebar sort.** Proposal §114 says replies are chronological within a thread. When sidebar sort is "Newest" or "Oldest," does that apply to top-level threads only (replies stay chronological)? Confirm.
- **Open Recent count.** Standard macOS pattern is 10 entries. Confirm.
- **Skill package size target.** Affects whether the Settings download button is "instant" or has a progress state.
- **Empty state copy.** The handoff mentions an empty state for files with no comments but the README doesn't show the copy. Worth a one-liner so it doesn't get invented in code.

## Things I want to confirm I read correctly

- Avatars are color-derived from a hash of the author name (deterministic per name). AI authors get the same treatment. The hue is stable, so "Claude" always gets the same color across files. ✓
- Suggested-edit accept replaces text + removes markers + removes YAML object entirely (terminal). Reject collapses + sets `resolved: true`. Per proposal §117, both should be terminal. **Note divergence:** your spec has Reject behaving like Resolve (keeps comment in file). Proposal §117 says reject "removes the markers and the comment" — terminal. Which is right? I lean toward the proposal (terminal Reject), because keeping rejected suggestions in the file as resolved threads pollutes the comment history without value. **Please reconcile.**
- Inline marker format is `<!-- fmc:N -->…<!-- /fmc:N -->` with integer IDs. ✓ matches proposal.
- Resolved comment markers stay invisible (they're HTML comments) — only the highlight decoration in the editor view is dimmed. ✓ matches proposal §119.
- 200ms max animations, no spring physics, no auto-summarize. ✓

## Implementation order

The 10-step order in the README is right. I'd add one milestone between (3) and (4): **fixture round-trip** — the YAML parser/serializer should produce byte-equivalent output for a representative set of input files (round-trip test) before any UI is built on top. This is the kind of thing that's painful to discover later.

## Net

Strong handoff. The two real items needing your attention before v1 implementation begins are:

- **Pushback 2 mitigation** (paragraph deletion / floating notes).
- **Pushback 4 design pass** (edit-during-open and save-conflict modals).

Plus the token/title-bar/pairing reconciliation. Everything else is small.
