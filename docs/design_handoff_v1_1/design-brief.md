# Forgemark — Design Brief

## What we're building

A desktop application for collaborative review of markdown documents by humans and AI agents working as peers. Think Google Docs commenting, except every annotation lives in the markdown file itself in a plain-text format that both humans and AI can read and write directly. It is a review tool, not an authoring tool.

Read `docs/markdown-commenter-proposal.md` first — this brief assumes you have.

- **Working name:** Forgemark
- **Platforms:** macOS first, Windows second
- **Tech stack:** Tauri (Rust + system webview, with a TypeScript UI). Treat the UI surface like a native desktop app, not a web page in a browser tab.

## Who uses it

Two co-primary users:

- **Human reviewers.** Technical reviewers, researchers, R&D leads, investors, writers using AI drafts. They open `.md` files, annotate, send them on. The GUI exists for them. Assume they are sharp, time-pressed, and have used Word/Google Docs commenting heavily.
- **AI agents (Claude, ChatGPT, etc.).** Peer participants. They read and write the same comments by editing the file directly, not through the GUI. The UI does not need to accommodate them, but it must faithfully render and interact with annotations they have written.

The design audience is the human reviewer. AI participation should feel native, not bolted-on.

## Design pillars

1. **Word/Docs familiarity.** A first-time user should know what to do without instruction. Borrow conventions from Google Docs and Microsoft Word commenting unless there is a specific reason to diverge.
2. **The file is the source of truth.** The UI should feel like it is editing a real markdown file, not pulling from a database. Raw-source view should not feel like an admin escape hatch — it should feel like a peer view of the same content.
3. **AI authors are first-class.** A comment by Claude or ChatGPT should look as natural as a comment by a human teammate. No "AI-generated" badges, warnings, or visual quarantine. They are peers.
4. **Quiet by default, generous on demand.** Inline highlights should be subtle when reading; the sidebar should be informative when engaging. Avoid loud color, dense chrome, or competing focal points.
5. **Native-feeling.** Use OS-appropriate window chrome, type ramp, and system controls. Tauri's system webview lets us lean on native fonts, dialogs, and accents.

## Anti-patterns

- Do not mimic GitHub PR review. This is prose review, not code review.
- Do not add an "AI" sidebar tab or chat panel. AI participation is invisible — same cards, same threading.
- Do not auto-categorize, auto-summarize, or auto-prioritize comments. The reviewer reads them.
- Do not skin a generic web app. Tauri was chosen specifically to feel native.

## Components and screens to design

Asterisked items are highest priority.

**Core: annotated document view**
- ⭐ Two-pane layout: rendered markdown editor on the left, sidebar of comment cards on the right.
- ⭐ Inline highlight states for an anchored passage: default, hovered, focused (when its card is selected), resolved (dimmed), orphaned ("questioned" treatment when the inline markers have drifted from `anchor_text` — see proposal §185).
- ⭐ Comment card states: unread, read, has-unread-replies, focused, resolved (collapsed), suggested-edit variant.
- Sidebar header: filter by author, filter by resolved/unresolved, sort options.
- Empty state when a file has no comments.

**Comment composer**
- ⭐ Inline composer that appears when the user selects text and initiates a comment.
- Submit button (Cmd+Enter / Ctrl+Enter is the accelerator; the button is the canonical path — every interaction other than typing must have a GUI control, see proposal §42).
- "Suggest edit" toggle that switches the composer into a from-/to-style replacement editor.
- Reply composer (appears under an existing card on Reply).
- Edit composer (when an author edits their own previous comment — sets `edited_at` on save).

**Suggested edits**
- ⭐ Visual treatment of a suggested-edit card with strikethrough on the original and an inserted alternative.
- Accept and Reject buttons. These are terminal — match the visual gravity Google Docs gives to them.

**Source view**
- Toggle between rendered view and raw markdown source. The raw view should display the inline anchor markers (`<!-- fmc:N -->` / `<!-- /fmc:N -->`) and the trailing comments block clearly. The reviewer should be able to point at a card in the sidebar and find the corresponding YAML object and inline markers in the source.

**Application chrome**
- Menu bar with every command (each shortcut shown next to its menu item).
- Title bar, file-modified state indicator, save-on-close prompt.
- Open / Save / "Clean Export" flows. Clean Export needs a confirmation modal — it removes all annotations from a copy of the file.
- First-run onboarding: set author name, see a sample annotated file.

**Settings / Preferences**
- Author name (free-text).
- Theme (light / dark / system).
- Font size.
- Skill package: a link to download the `.skill` archive AI agents use to learn the format. This is a small but important affordance — it is how AI participation gets onboarded.

**Brand**
- Application icon (macOS `.icns`, Windows `.ico`).
- Wordmark / type lockup if needed.
- Light and dark themes — both should feel intentional, not one retrofitted to the other.

## Key flows to storyboard

1. **First run.** Set author name, open a sample file with a few existing comments by a human and an AI.
2. **Add a comment.** Select text → keyboard shortcut or right-click → composer appears → type → submit → card lands in sidebar with anchor highlight in document.
3. **Reply to an AI comment.** Focus a card by Claude → click Reply → type → submit. Show the threaded card.
4. **Suggest an edit.** Select text → toggle Suggest Edit → type replacement → submit → card shows from/to → another reviewer (or AI) clicks Accept → text in document updates, card disappears.
5. **Re-open a file edited externally.** Anchor drift triggers orphan recovery (see proposal §185) — show the orphan section in the sidebar and the "questioned" highlight in the document.
6. **Clean export.** File menu → Clean Export → confirmation → save dialog → resulting clean `.md` with no annotations.

## Constraints

- **Tech:** Tauri (system webview); UI in TypeScript with a framework like Svelte or React. Native dialogs and OS conventions where Tauri exposes them.
- **Markdown dialect:** GitHub Flavored Markdown baseline (headings, lists, tables, code blocks with syntax highlighting, links, images, footnotes).
- **Accessibility:** Keyboard navigation must reach every command (we already require GUI controls for everything; pair them with proper focus handling and ARIA where the webview surfaces it). Type ramp should respect user-set font size; color contrast at WCAG AA in both themes.
- **Out of scope for v1:** Multi-author concurrent annotation merging, real-time co-editing, mobile, internationalization beyond Latin scripts.

## Visual references

- **Linear** — calm chrome, generous whitespace, opinionated type.
- **Apple Notes** — native macOS feel, content-first.
- **Google Docs comment sidebar** — interaction patterns to borrow, not visual style to copy.
- **iA Writer** — markdown-aware restraint.
- **Cursor / Zed** — editor surfaces with decorations layered on prose.

## Deliverables

- A component library / design tokens doc (color, type, spacing, elevation) that engineering can extract values from.
- High-fidelity mocks of the screens above. Wireframes welcome as an interim step, but final delivery should be color-, type-, and state-correct.
- An interactive prototype or recorded walkthrough of the six flows above.
- A short design-rationale note (two pages, not twenty) covering the calls you made and why.
- Pushback: if the design surfaces a tension the proposal hasn't accounted for, flag it. Don't silently work around it.

## Open questions for your input

1. Should the comments sidebar live on the right (Google Docs style) or be detachable into a separate window?
2. Resolved comments are dimmed inline — should they also be hidden by default in the sidebar, or just collapsed?
3. Should the rendered/source toggle be per-document state, a global preference, or both?
4. Is there a useful "diff" view when an AI agent has made unsolicited edits to the document body alongside its comments? The proposal does not address this.
5. How should the "questioned" highlight for orphaned comments look — distinct enough to notice, restrained enough not to alarm?

## Where to send things

Drop deliverables into the `forgemark` repo under `design/`. Open issues for questions. Tag me on anything that needs a product call before you can proceed.
