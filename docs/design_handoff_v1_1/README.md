# Handoff: Forgemark — v1.1 (revised after dev review)

> **A desktop application for collaborative review of markdown documents by humans and AI agents.** This handoff covers the v1 surface — annotated document view, composer, suggested edits, source view, lost-anchor recovery, app chrome, settings, onboarding, and clean export.

> **What's new in this revision (after AI developer review):**
> - Tokens reconciled — `tokens.js` is now the single source of truth; this README's tables are regenerated from it.
> - Title-bar measurements clarified (44px combined chrome, not 28).
> - `editorial` pairing commented out in `tokens.js` (considered, not shipped).
> - Three new design states added — see new files in `Forgemark - Design System.html` (search **CONFLICTS & FLOATING**): conflict banner, save-conflict modal, edit-during-open modal (clean + with-unsaved-edits), floating-note sidebar section + card variant, three-option Reattach modal.
> - Wordmark / glyph candidates added.
> - Source-view "selection-to-comment unavailable" notice added.
> - **Reject-suggestion is now terminal** (matches proposal §117) — see [§5](#5-suggested-edit-acceptreject).
> - All v1.0 clarifications answered inline below.

---

## About the Design Files

The files in this bundle are **design references created in HTML+React for prototyping**. They are not production code to copy directly. Your task is to **recreate these designs in the Forgemark codebase using its established stack** (Tauri + Rust backend, TypeScript UI in React or Svelte). Pull exact values — colors, type, spacing, copy, behavior — from the prototype and the tables below. Reach for the codebase's existing patterns (state management, routing, IPC) for everything except the visual surface itself.

If no UI framework exists yet, **React + TypeScript + CSS Modules (or Tailwind)** is recommended — the prototype is React-based and translates cleanly. Svelte is also fine; the components are small and declarative.

The visual surface targets **macOS first** (system webview via Tauri), with Windows as a secondary target. SF Pro and SF Mono are loaded via `-apple-system`; on Windows fall back to Segoe UI / Cascadia Mono. All `traffic light` chrome should be replaced by Tauri's native window controls — do not ship a CSS imitation.

---

## Fidelity

**High-fidelity.** The prototype is pixel-correct on:

- Colors (full token table below; values match `tokens.js` exactly — that file is the source of truth)
- Typography (font stacks, sizes, weights, leading, tracking)
- Spacing, border-radius, dividers, shadows
- Interaction states (default/hover/focus/resolved/lost-anchor for both anchors and cards)
- Copy (every label and microcopy in the prototype is final unless flagged as `[placeholder]`)

The prototype is **not** the source of truth on:
- Animations & transition timings (use codebase conventions; targets noted below)
- Window chrome (use Tauri-native; traffic-light SVG in prototype is decorative)
- Performance (the prototype runs on a hard-coded 6-comment fixture; the real app must virtualize the sidebar above ~50 cards)
- The sidebar filter dropdown — see note on hardcoded `By Claude` in [§State Management](#state-management).

---

## Files in This Bundle

| File | Purpose |
|------|---------|
| `Forgemark.html` | **The interactive prototype.** Open this first. All six flows from the brief are wired. |
| `Forgemark - Design System.html` | Token reference, type pairings, full state matrices for highlights and cards, secondary screens, conflict & floating-note states, wordmark candidates. |
| `Forgemark - Storyboard.html` | Six-frame storyboard of the canonical flows. |
| `Forgemark - Rationale.html` | Two-page memo: decisions, what we changed our mind about, four pieces of pushback, and (revised) follow-through on the dev review. Read this before implementing. |
| `app.jsx` | Top-level prototype component — owns interaction state. |
| `chrome.jsx` | Title bar, sidebar header, source-view rendering. |
| `comment-card.jsx` | The `<FMCard>` component — every card state. |
| `sample-doc.jsx` | Sample document body + initial comment fixtures. |
| `design-system-canvas.jsx` | Components for the design-system canvas. |
| `tokens.js` | **Source of truth** for all design tokens — light + dark themes. |
| `tweaks-panel.jsx`, `design-canvas.jsx`, `macos-window.jsx` | Prototype scaffolding (frame, panel, canvas). Not part of the product surface. |
| `design-brief.md` | The original brief. |
| `markdown-commenter-proposal.md` | The product proposal — referenced throughout. Treat this as the spec for file format and behavior. |

---

## Tech Stack Assumptions

- **Tauri** (Rust + system webview) for the shell, native dialogs, native menus, file watching, file I/O.
- **TypeScript + React** (or Svelte) for the UI surface.
- **GitHub Flavored Markdown** parser of choice (e.g. `unified` + `remark-gfm`) for rendered view.
- **Native menu bar** assembled in Tauri — do **not** render an in-window menu strip on macOS.
- **System theme** detection through `prefers-color-scheme` + Tauri's appearance API.

---

## Design Tokens

`tokens.js` is the source of truth. The tables below are **regenerated from that file**; if you find a mismatch, the file wins and this doc is stale — flag it and we'll update.

### Light theme

| Token (CSS var)              | Value (from `tokens.js`)             | Role                                                  |
|------------------------------|--------------------------------------|-------------------------------------------------------|
| `--fm-window-bg`             | `#ECECEC`                            | Behind window (visible at corners during resize)      |
| `--fm-titlebar-bg`           | `#E8E8E6`                            | Title-bar + toolbar chrome                            |
| `--fm-titlebar-border`       | `rgba(0,0,0,0.10)`                   | Bottom edge of title bar                              |
| `--fm-chrome-text`           | `rgba(0,0,0,0.78)`                   | Primary chrome text                                   |
| `--fm-chrome-muted`          | `rgba(0,0,0,0.50)`                   | Secondary chrome text                                 |
| `--fm-chrome-faint`          | `rgba(0,0,0,0.30)`                   | Tertiary chrome (modified-dot, disabled)              |
| `--fm-divider`               | `rgba(0,0,0,0.08)`                   | Hairline dividers                                     |
| `--fm-divider-strong`        | `rgba(0,0,0,0.14)`                   | Heavier dividers, button borders                      |
| `--fm-editor-bg`             | `#FCFCFB`                            | Document pane background                              |
| `--fm-prose-ink`             | `#1B1B1A`                            | Primary prose text                                    |
| `--fm-prose-muted`           | `rgba(27,27,26,0.62)`                | Secondary prose text                                  |
| `--fm-prose-faint`           | `rgba(27,27,26,0.40)`                | Tertiary text, timestamps, marker dimming             |
| `--fm-rule`                  | `rgba(0,0,0,0.10)`                   | In-prose rules                                        |
| `--fm-code`                  | `rgba(0,0,0,0.045)`                  | Inline-code background                                |
| `--fm-code-border`           | `rgba(0,0,0,0.08)`                   | Inline-code border                                    |
| `--fm-sidebar-bg`            | `#F4F3F0`                            | Sidebar background (warm off-white)                   |
| `--fm-card-bg`               | `#FFFFFF`                            | Card surface (default + elevated)                     |
| `--fm-card-border`           | `rgba(0,0,0,0.08)`                   | Default card border                                   |
| `--fm-card-border-focused`   | `rgba(0,0,0,0.18)`                   | Focused card border                                   |
| `--fm-card-shadow`           | `0 1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.04)` | Default card elevation        |
| `--fm-card-shadow-focused`   | `0 1px 0 rgba(0,0,0,0.06), 0 6px 18px rgba(0,0,0,0.10)` | Focused card elevation       |
| `--fm-anchor-bg`             | `rgba(255,200,72,0.22)`              | Default anchor highlight                              |
| `--fm-anchor-bg-hover`       | `rgba(255,200,72,0.38)`              | Hovered anchor                                        |
| `--fm-anchor-bg-focus`       | `rgba(255,200,72,0.55)`              | Focused anchor (card selected)                        |
| `--fm-anchor-bg-resolved`    | `rgba(0,0,0,0.05)`                   | Resolved anchor (dimmed)                              |
| `--fm-anchor-underline`      | `rgba(180,130,0,0.55)`               | Hairline under focused anchor                         |
| `--fm-suggest-bg`            | `rgba(60,170,90,0.10)`               | Suggested-edit anchor                                 |
| `--fm-suggest-bg-focus`      | `rgba(60,170,90,0.20)`               | Focused suggestion anchor                             |
| `--fm-suggest-text`          | `#1F8A5B`                            | Suggestion-replacement text                           |
| `--fm-suggest-stroke`        | `rgba(60,170,90,0.45)`               | Suggestion underline                                  |
| `--fm-orphan-underline`      | `rgba(168,85,170,0.85)`              | Lost-anchor dashed underline                          |
| `--fm-orphan-text`           | `#A055A8`                            | Lost-anchor label, banner icon                        |
| `--fm-accent`                | `#0A84FF`                            | macOS system blue — primary actions, focus            |
| `--fm-accent-hover`          | `#1F8FFF`                            | Accent button hover                                   |
| `--fm-accent-text`           | `#FFFFFF`                            | Text on accent fill                                   |
| `--fm-accent-soft`           | `rgba(10,132,255,0.10)`              | Accent tint for selected rows                         |
| `--fm-accent-soft-strong`    | `rgba(10,132,255,0.18)`              | Accent tint, stronger                                 |
| `--fm-success`               | `#1F8A5B`                            | Accept-suggestion fill                                |
| `--fm-danger`                | `#D70015`                            | Destructive actions (Discard, Overwrite warning)      |
| `--fm-text-selection`        | `rgba(10,132,255,0.18)`              | Native selection wash                                 |

### Dark theme

| Token (CSS var)              | Value (from `tokens.js`)             |
|------------------------------|--------------------------------------|
| `--fm-window-bg`             | `#1B1B1B`                            |
| `--fm-titlebar-bg`           | `#2A2A2A`                            |
| `--fm-titlebar-border`       | `rgba(255,255,255,0.08)`             |
| `--fm-chrome-text`           | `rgba(255,255,255,0.86)`             |
| `--fm-chrome-muted`          | `rgba(255,255,255,0.55)`             |
| `--fm-chrome-faint`          | `rgba(255,255,255,0.32)`             |
| `--fm-divider`               | `rgba(255,255,255,0.07)`             |
| `--fm-divider-strong`        | `rgba(255,255,255,0.14)`             |
| `--fm-editor-bg`             | `#1F1F1F`                            |
| `--fm-prose-ink`             | `#ECECEC`                            |
| `--fm-prose-muted`           | `rgba(236,236,236,0.62)`             |
| `--fm-prose-faint`           | `rgba(236,236,236,0.40)`             |
| `--fm-rule`                  | `rgba(255,255,255,0.10)`             |
| `--fm-code`                  | `rgba(255,255,255,0.06)`             |
| `--fm-code-border`           | `rgba(255,255,255,0.10)`             |
| `--fm-sidebar-bg`            | `#262626`                            |
| `--fm-card-bg`               | `#2D2D2D`                            |
| `--fm-card-bg-elevated`      | `#333333`                            |
| `--fm-card-border`           | `rgba(255,255,255,0.08)`             |
| `--fm-card-border-focused`   | `rgba(255,255,255,0.18)`             |
| `--fm-card-shadow`           | `0 1px 0 rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.4)`         |
| `--fm-card-shadow-focused`   | `0 1px 0 rgba(0,0,0,0.5), 0 8px 22px rgba(0,0,0,0.55)`       |
| `--fm-anchor-bg`             | `rgba(255,200,72,0.16)`              |
| `--fm-anchor-bg-hover`       | `rgba(255,200,72,0.26)`              |
| `--fm-anchor-bg-focus`       | `rgba(255,200,72,0.40)`              |
| `--fm-anchor-bg-resolved`    | `rgba(255,255,255,0.05)`             |
| `--fm-anchor-underline`      | `rgba(255,200,72,0.65)`              |
| `--fm-suggest-bg`            | `rgba(60,200,120,0.14)`              |
| `--fm-suggest-bg-focus`      | `rgba(60,200,120,0.26)`              |
| `--fm-suggest-text`          | `#5FCB8B`                            |
| `--fm-suggest-stroke`        | `rgba(60,200,120,0.50)`              |
| `--fm-orphan-underline`      | `rgba(220,140,225,0.85)`             |
| `--fm-orphan-text`           | `#D599DA`                            |
| `--fm-accent`                | `#0A84FF`                            |
| `--fm-accent-hover`          | `#3998FF`                            |
| `--fm-accent-soft`           | `rgba(10,132,255,0.18)`              |
| `--fm-accent-soft-strong`    | `rgba(10,132,255,0.30)`              |
| `--fm-success`               | `#30D158`                            |
| `--fm-danger`                | `#FF453A`                            |
| `--fm-text-selection`        | `rgba(10,132,255,0.30)`              |

> **Naming convention.** `tokens.js` exports camelCase keys (e.g. `anchorBgFocus`); the CSS var names above (e.g. `--fm-anchor-bg-focus`) are the prototype's `kebab-case` mapping. Adopt either consistently — the table maps one-to-one.

### Typography (locked: Native pairing)

| Use | Stack | Size | Weight | Leading | Tracking |
|-----|-------|------|--------|---------|----------|
| UI text (chrome, sidebar, buttons) | `-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif` | 12–13 | 400/500/600 | 1.45 | normal |
| UI display (title bar, headings in modals) | `-apple-system, "SF Pro Display", …` | 14–32 | 600 | 1.15–1.3 | -0.012em on >18px |
| Prose body (rendered markdown) | `-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif` | 17 (user-tunable 14–22) | 400 | 1.55 | -0.005em |
| Mono (source view, anchor markers, kbd) | `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` | 13 | 400 | 1.65 | normal |

User-tunable prose size lives in **View → Increase / Decrease Text Size** (⌘+ / ⌘−). Range 14–22, step 1, default 17. **Persists per-user in app preferences** (not per-document).

> The `editorial` pairing (Charter prose + SF chrome) was explored and **not shipped** for v1; it's commented out in `tokens.js`. Do not wire user-facing controls to it.

### Spacing & radii

- **Card padding:** 12px 14px (regular density — locked)
- **Card gap:** 10px
- **Card border-radius:** 8px
- **Button border-radius:** 6px
- **Modal border-radius:** 10px
- **Sidebar width:** 320px (fixed)
- **Document max-width:** 720px (centered in editor pane)
- **Editor pane padding:** 32px 48px (vertical/horizontal)
- **Hairlines:** 0.5px (use `0.5px` literally — Tauri's webview honors sub-pixel borders on macOS)

### Elevation

- **Card focused:** see `--fm-card-shadow-focused` token in both themes
- **Composer:** `0 14px 36px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.10)` (light) / `0 16px 40px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.30)` (dark)
- **Modal:** `0 24px 60px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)`

---

## Screens / Views

### 1. Two-pane document view (primary screen)

**Purpose.** The default and dominant screen. Reviewer reads the rendered markdown on the left, sees comment cards in document order on the right, and interacts with both pinned together.

**Layout.**
- `display: flex; flex-direction: column` window root
- **Title bar (44px combined chrome) — native on macOS.** This is one row that combines the OS title strip (~28px) with a 16px toolbar inset, giving the standard macOS *titlebar-with-toolbar* shape. Holds: traffic-light controls (Tauri-native), modified-dot + centered file name, segmented control on the right (Rendered/Source) and a sidebar-toggle icon.
- Body: `flex: 1; display: flex` — editor pane (`flex: 1`, max-content-width 720px centered) + sidebar (`width: 320px`, hairline left border)

**Editor pane.**
- Vertically scrolls independently from sidebar
- Renders GFM (headings, lists, tables, code with syntax highlighting, links, images, footnotes)
- `<Anchor id={N}>...</Anchor>` wrappers around every inline-marker pair render as `<span class="fm-anchor">` with the highlight states below
- Selection persists during composer interactions (do not clear native selection while composer is open)
- When `lostAnchorCount > 0` and view is rendered, render the **lost-anchor banner** above the prose (see banner spec below)
- When the underlying file has changed externally, render the **file-conflict banner** (see [§Conflicts](#11-file-conflict-banner-and-modals))

**Sidebar.**
- Header: comment counts, filter dropdown, sort toggle (`Doc order` / `Newest` / `Oldest`)
- Body: `lost-anchor section` (if any) → `floating notes section` (if any) → live cards in document order → resolved section (collapsed cards in place when `showResolved`)
- Empty state when no comments at all (copy: **"No comments yet."** / **"Select text in the document to start a review."**)
- Cards click-to-focus; clicking outside any card unfocuses (also closes any open composer)

**Visual reference:** every state is enumerated in `Forgemark - Design System.html` → "Highlight states" and "Card states" sections.

---

### 2. Anchor highlight states (inline)

| State | Visual |
|-------|--------|
| **Default** | `background: var(--fm-anchor-bg)`, no border |
| **Hover** | `background: var(--fm-anchor-bg-hover)`, cursor `default` |
| **Focused** (card selected) | `background: var(--fm-anchor-bg-focus)`, `border-bottom: 0.5px solid var(--fm-anchor-underline)` |
| **Resolved** | `background: var(--fm-anchor-bg-resolved)` (dimmed, kept inline as a breadcrumb) |
| **Suggested edit** | `background: var(--fm-suggest-bg)` (green tint instead of yellow) |
| **Suggested edit · focused** | `background: var(--fm-suggest-bg-focus)`, `border-bottom: 0.5px solid var(--fm-suggest-stroke)` |
| **Lost anchor** | No fill. `border-bottom: 1px dashed var(--fm-orphan-underline)`, `text-underline-offset: 3px` |
| **Floating note** | *No inline highlight at all.* The card lives in the sidebar's `Floating notes` section without a document anchor. (see [§7d](#7d-floating-notes-and-the-three-option-reattach-modal)) |

Highlight transitions: `background-color 120ms ease-out`. Do not transition the dashed underline.

---

### 3. Comment card states

The `<FMCard>` component is the workhorse. Every state is in `comment-card.jsx`. Recreate it as one component with prop-driven rendering.

| State | Behavior |
|-------|----------|
| **Unread** | 2px left strip in `var(--fm-accent)`, body unmuted, `state: "unread"` in source |
| **Read** | No left strip, body unmuted |
| **Has-unread-replies** | Collapsed with "+N replies" badge in `var(--fm-accent)`; expands on focus |
| **Focused** | Elevated shadow + 1px accent ring; reveals action row (Reply / Edit / Resolve / ⋯) |
| **Resolved** (collapsed) | Single line: avatar + author + checkmark + first 60 chars of body, **markdown stripped to plain text** — i.e. `**Bold** and italic` collapses to `Bold and italic`. Click to expand. |
| **Suggested edit** | Body replaced by from/to block: original `text-decoration: line-through` muted, replacement `background: var(--fm-suggest-bg)` `color: var(--fm-suggest-text)`. Focused action row: filled-green **Accept** ✓ + tertiary **Reject** |
| **Lost anchor** | 2px left strip in `var(--fm-orphan-underline)`. Below body: a magenta-tinted info row with the original `anchor_text` in italics. Focused action row: filled-blue **Reattach…** + tertiary **Discard** |
| **Floating note** *(NEW)* | 2px left strip in `var(--fm-chrome-muted)` (not magenta — this state is steady-state, not a recovery state). A small **No anchor** chip below the body in italics + paperclip-with-slash glyph. Focused action row: **Reattach…** (tertiary) + **Discard** |

**Card structure (top to bottom):**
1. Author row: 22px circular avatar (initial, deterministic-color background) + name (12.5px/600) + relative timestamp (11.5px muted) + edited-indicator if `edited_at`
2. Body (13px prose, 1.55 leading)
3. Replies (each: 8px left padding, 2px hairline left border, repeats author row + body)
4. Lost-anchor info row OR floating-note chip (only when applicable)
5. Action row (only when focused; hairline top border, 10px padding-top)

**Avatars are deterministically colored from the author name.** Stable hue per name (so "Claude" is always the same color across files); chroma kept low so no avatar dominates. AI authors get **the same** treatment — no glyph, no badge.

---

### 4. Composer

Three composer variants share one component, switched by `mode`:

#### 4a. New comment composer
- Floats absolutely beside the selection in the editor pane (anchored to selection bounds, max 360px wide)
- Top: 1-line author chip ("**Maya** is commenting" muted)
- Middle: `<textarea>`, autosize 36–180px
- Bottom row: **Suggest edit** toggle (left), keyboard hint `⌘↵` (right of toggle), filled-blue **Comment** button (right)
- ⌘↵ submits; Esc cancels and clears the selection
- On submit: anchor markers `<!-- fmc:N --> <!-- /fmc:N -->` are inserted into the source around the selected text; YAML object appended; sidebar scrolls new card into view; card lands focused

#### 4b. Reply composer
- Appears nested under a focused card (same indentation as displayed replies)
- Single-line affordance until clicked; expands on focus
- Same submit behavior; on submit the parent thread sets `has-unread-replies` for other authors

#### 4c. Edit composer
- Replaces the body content of the user's own existing comment in place
- `Save` button replaces `Comment`; on save, sets `edited_at` to now (ISO 8601 UTC)
- Other authors cannot edit; control is hidden when `comment.author !== preferences.authorName`

#### 4d. Suggest-edit composer (toggle from 4a)
- Toggling **Suggest edit** swaps the textarea for two stacked fields: `Original` (read-only, populated from selection) + `Replacement` (editable, autosize)
- Submit text changes to **Suggest** instead of **Comment**

---

### 5. Suggested-edit accept/reject

Both terminal — match the visual gravity Google Docs gives them.

- **Accept** (filled `var(--fm-success)`, white text, ✓ glyph):
  - Replace the original passage in the document body with the replacement text
  - **Remove the comment YAML object and its inline marker pair from the file**
  - Remove the card from the sidebar with a 200ms fade
  - Mark file modified

- **Reject** (tertiary, hairline border) — *revised, now matches proposal §117:*
  - **Remove the comment YAML object and its inline marker pair from the file** (terminal — same lifecycle as Accept, but no body replacement)
  - Remove the card from the sidebar with a 200ms fade
  - Mark file modified

> **Note for engineering:** the v1.0 spec had Reject behave like Resolve (kept the comment with `resolved: true`). The reviewer flagged this against proposal §117 ("reject removes the markers and the comment"). v1.1 reconciles to the proposal — both Accept and Reject now strip the comment from the file. The prototype's reject button is updated accordingly.

> **Undo.** Both actions are terminal with no in-app undo for v1; rely on file save discipline (and Cmd+Z works at the OS / git level for files on disk). Worth an in-app undo follow-up; out of scope for v1.

---

### 6. Source view

- Toggled per-document via segmented control in the title bar (rendered ↔ source). Default rendered. State does **not** persist across sessions or files (per-document, in-memory). The default-on-open value is settable in **Settings → General → Default view**.
- Renders the raw markdown text in `var(--fm-mono)` 13px / 1.65, dimmed `<!-- fmc:N -->` markers (`color: var(--fm-prose-faint)`), syntax-highlighted code fences
- Trailing `<!-- forgemark-comments` block rendered with subtle background tint to delineate it as the comments YAML block
- Cards in the sidebar still highlight on hover, scroll the source to the matching marker, and select-focus the matching YAML object
- **Read-mostly:** selection-to-comment is not available in source view (would corrupt marker placement). Selection still selects natively for copy.
- **NEW — UI affordance for the unavailability:** while source view is active, render a small **"Source view · read-only review"** chip in the editor pane's top-left (12px UI text, muted, with an "info" glyph). Hovering the chip surfaces a tooltip: *"Selection-to-comment is unavailable in source view. Switch to Rendered (⌘⇧M) to add comments."* This chip is in the design system canvas under **Source-view notice**.

---

### 7. Lost-anchor recovery

#### 7a. In-document banner
- Renders above the prose when any comment is in `lost-anchor` state
- 720px max-width, centered, 0.5px magenta border, magenta-tinted background
- Copy: **"N comments lost their anchors."** (bold) + **"The file was edited outside Forgemark and the original passages can't be located."** (muted)
- Right-aligned filled-blue **Recover…** button — opens reattach modal for the first lost-anchor comment

#### 7b. Sidebar lost-anchor section
- Pinned to top of sidebar above all live cards
- Header: `LOST ANCHOR · N` (10.5px/700, uppercase, 0.07em tracking, magenta)
- Cards below — same `<FMCard>` with `lost-anchor` state. Action row reveals on focus.

#### 7c. Reattach modal
- Modal dialog (540px), centered, 0.42 black backdrop with subtle blur
- Header: "Reattach lost anchor" (14px/600) + the original anchor_text in italics + the comment author name
- Body: vertical list of candidate passages, each:
  - Match score (0–100%, monospace, 0.04em tracking, `var(--fm-success)`) or `MANUAL` badge
  - One-sentence reason (e.g. "best fuzzy match · context_before aligned")
  - Passage preview with the matched span highlighted as a yellow anchor
  - Click to select; selected row gets blue tint + 0.5px accent border
- Footer (revised, three options): **Discard comment** (tertiary, left, `var(--fm-danger)` text on hover) · **Keep as floating note** (tertiary, middle, *NEW*) · **Cancel** + **Reattach here** (filled blue, right)

**Candidate sourcing** (proposal §185): (1) fuzzy match on `anchor_text` + `context_before/after` windows, (2) embedding similarity on the comment body if first pass returns < 0.4, (3) a final "MANUAL — pick from document" affordance that puts the editor pane in passage-pick mode.

#### 7d. Floating notes and the three-option Reattach modal

When **no candidate** can be located (or the user explicitly chooses **Keep as floating note** in the Reattach modal), the comment becomes a **floating note**:

- Schema: `floating: true` flag is set on the comment YAML object; `anchor_text` becomes optional. The inline `<!-- fmc:N -->` marker pair is **removed from the body** since there's nothing to anchor it to. The YAML object stays in the trailing comments block.
- Card variant: see [§3](#3-comment-card-states) — "Floating note" row.
- Sidebar section: a new **`FLOATING NOTES · N`** section header (10.5px/700, uppercase, 0.07em tracking, `var(--fm-chrome-muted)` — neutral grey, not magenta — slotted **between** the lost-anchor section and the live ordered cards).
- Behavior: floating-note cards still support reply, edit, resolve. The action row also surfaces a **Reattach…** button — clicking opens the same Reattach modal in **MANUAL** mode (the editor pane becomes passage-pick), where the user can re-anchor the note to a fresh selection.

The Reattach modal's footer therefore has **three terminal choices**:
1. **Discard comment** — destructive, removes the YAML object entirely
2. **Keep as floating note** — non-destructive, sets `floating: true`, drops the marker, keeps the comment in the file
3. **Reattach here** — re-anchors to the highlighted candidate (or MANUAL pick)

These are all in `Forgemark - Design System.html` under **CONFLICTS & FLOATING**.

---

### 8. Application chrome

- **Title bar (macOS):** native traffic-light controls (Tauri `decorations: true` + custom title rendering), file name centered, modified dot (small grey filled circle) immediately to the left of the file name when unsaved, segmented control on the right (rendered/source) and sidebar-toggle icon. **Total chrome height: 44px** (the standard macOS *titlebar-with-toolbar* combined row).
- **Native menu bar (macOS):** every command exposed (proposal §42 — every interaction except typing must have a GUI path)
  - **File:** New… ⌘N · Open… ⌘O · Open Recent → (10 entries max — standard macOS) · Save ⌘S · Save As… ⇧⌘S · Clean Export… ⇧⌘E · Close ⌘W · Quit ⌘Q
  - **Edit:** Undo · Redo · Cut · Copy · Paste · Find ⌘F
  - **Comment:** New Comment ⌘⌥M · Suggest Edit ⌘⌥E · Reply ⌘R · Resolve ⌘⏎ · Edit ⌘⇧E · Delete · Reattach…
  - **View:** Increase Text Size ⌘+ · Decrease Text Size ⌘− · Reset Text Size ⌘0 · Toggle Source View ⌘⇧M · Toggle Sidebar ⌘⌥S
  - **Window / Help:** standard
- **Save-on-close prompt:** native macOS "Do you want to save…" sheet via Tauri dialog when modified=true and user closes window or quits
- **First-run onboarding:** single screen with the Forgemark glyph, a name field (focus pre-placed), Skip / Open sample → buttons. Lands the user in a sample file pre-populated with one human and one AI comment.

---

### 9. Settings / Preferences

Single window, native macOS Settings shape (toolbar with sections):

- **General:** Author name (text field) · Theme (segmented: Light / Dark / System) · Font size (stepper, 14–22) · Default view (segmented: Rendered / Source — applies to next opened document)
- **AI participation:** Skill package (description + filled-blue **Download .skill** button — links to bundled `.skill` archive that AI agents use to learn the format)
- **About:** version, build, copyright, link to repo

**Skill package details** (engineering):
- **Bundled** with the app (not fetched), so the button is instant — no progress state needed in v1.
- Target size: ~30–60 KB (a handful of markdown + YAML examples + a short README.md instructing the agent on the file format).
- Download writes to `~/Downloads/forgemark.skill` via Tauri `dialog.save` (default name preset; user can change location).
- Contents minimum: the format spec (proposal §183–185 extracted), 3 sample annotated files, 1 README that an LLM agent can ingest as a single prompt to learn the format. Final manifest is engineering's call — keep it tight.

---

### 10. Clean Export

- Triggered from File → Clean Export… (⇧⌘E)
- Confirmation modal (280px, native sheet shape):
  - Title: "Export a clean copy?"
  - Body: "This will save a new file with all N comments and anchor markers stripped. The current file is unchanged."
  - Cancel + filled-blue **Choose location…**
- On confirm: opens native macOS save panel (Tauri `dialog.save`)
- Output file: prose only — no inline markers, no trailing YAML block, no `<!-- forgemark-comments` marker, no skill metadata

---

### 11. File-conflict banner and modals *(NEW — added in revision)*

The brief and proposal don't define what happens when the underlying `.md` file changes outside Forgemark while the user has it open. v1.1 specifies it.

#### 11a. File-conflict banner (in editor pane)
- Triggered when Tauri's file watcher fires for the open file and the app is not in the middle of its own save
- 720px max-width, centered, 0.5px `var(--fm-chrome-faint)` border, neutral-tinted background — *not* magenta (this is procedural, not lost data)
- Copy: **"This file was modified outside Forgemark."** (bold) + relative timestamp ("about a minute ago") + author hint if the new comments reveal one
- Right-aligned action row: **Reload from disk** (filled blue, primary) · **Keep your version** (tertiary)
- Banner is dismissible with a small × on the right edge — equivalent to **Keep your version**, but without setting any "local wins on next save" flag (see save-conflict, §11c)

#### 11b. Edit-during-open modal (when user has unsaved work)
- Used in place of the banner when the user has *any* of: unsaved composer draft, unsaved card edits, unsaved replies, or modified=true
- Modal (480px), centered, with the standard modal backdrop. Cannot be dismissed by clicking the backdrop — the user must choose.
- Header (16px/600): **"Reload this file?"**
- Body:
  - "The file was modified outside Forgemark." (muted)
  - **Inline diff hint:** "Your unsaved work: *one open composer · two edited cards*." in 12.5px muted, with a small disclosure triangle that expands a list of the unsaved items.
  - "Reloading will discard your unsaved work." (`var(--fm-danger)` text, NOT a banner — keep it inline)
- Footer: **Reload from disk** (filled blue) · **Keep your version** (default outlined, focus-ringed) · **Cancel**
- *"Cancel"* leaves the conflict pending; the banner re-appears next idle moment.

#### 11c. Save-conflict modal (on ⌘S when underlying file has changed)
- Triggered by ⌘S / autosave when the file's mtime or content hash has changed since open and the user pressed save
- Modal (480px), centered
- Header (16px/600): **"This file changed on disk."**
- Body:
  - "Forgemark would overwrite changes made by another author or process."
  - A two-column comparison strip: **Your version** (count of unsaved comments / edits) · **On disk** (count of new comments / edits if detectable; "Unknown changes" if the content can't be diffed cleanly).
- Footer: **Cancel and inspect** (default outlined, primary action — opens a *read-only diff drawer* in the sidebar; out of scope for v1 implementation, but the button must be present so users have a way out) · **Overwrite disk version** (`var(--fm-danger)` text on white, hairline border — destructive but allowed)
- "Reload from disk" is **not present** here; reloading on a save attempt would silently discard local changes, so we omit the option entirely. The user has to either inspect the conflict or commit to overwriting.

> **Implementation note:** the file watcher in 11a/11b and the mtime/hash check in 11c share the same conflict-detection pipeline. Detect once, route to the right surface based on (`hasUnsavedWork`, `userInitiatedSave`).

All three are in `Forgemark - Design System.html` under **CONFLICTS & FLOATING**.

---

## Interactions & Behavior

| Interaction | Trigger | Behavior |
|-------------|---------|----------|
| Add comment | ⌘⌥M when text selected, or right-click → New Comment, or Comment menu | Composer appears beside selection |
| Reply | Click Reply on focused card, or ⌘R when card focused | Nested composer expands |
| Edit own comment | Click ⋯ → Edit on own focused card | Body becomes editable; Save commits + sets `edited_at` |
| Resolve | Click ✓ icon on card hover, or ⌘↵ when card focused | Card collapses to one line; anchor dims |
| Reopen resolved | Click reopen icon on collapsed card | Card expands; anchor returns to full saturation |
| Accept suggestion | Click Accept on focused suggestion card | Body text replaces; YAML + markers removed; card removed; file modified |
| Reject suggestion | Click Reject | **YAML + markers removed; card removed; file modified** *(revised — terminal, matches §117)* |
| Reattach lost anchor | Click Recover on banner, or Reattach on lost-anchor card | Modal opens with ranked candidates; three terminal choices |
| Keep as floating note | Click in Reattach modal footer | Comment marked `floating: true`; markers stripped; card moves to Floating notes section |
| Toggle source view | View menu, ⌘⇧M, or segmented control in title bar | Editor pane swaps; sidebar persists; "Source view · read-only review" chip appears |
| Filter comments | Click filter dropdown in sidebar header | Cards filter in place; sort persists |
| Sort comments | Click sort toggle | Doc order / Newest / Oldest. **Replies stay chronological inside their threads** regardless of sort — sort applies to top-level cards only (proposal §114). |
| Clean Export | File → Clean Export, or ⇧⌘E | Confirmation modal → native save sheet |
| External file change | File watcher fires when nothing unsaved | File-conflict banner ([§11a](#11a-file-conflict-banner-in-editor-pane)) |
| External file change w/ unsaved work | File watcher fires + dirty state | Edit-during-open modal ([§11b](#11b-edit-during-open-modal-when-user-has-unsaved-work)) |
| Save-on-conflict | ⌘S when file has changed on disk since open | Save-conflict modal ([§11c](#11c-save-conflict-modal-on-s-when-underlying-file-has-changed)) |

**Animation timings.** All transitions ≤ 200ms, ease-out. Card focus shadow: 120ms. Composer slide-in: 160ms. Card removal (after Accept/Reject): 200ms fade + collapse. No spring physics; this is content tooling, not a phone app.

**Hover states.** Every interactive element has a hover state. Cards: subtle elevation lift. Buttons: background tint by 4% darker (light) / lighter (dark). Anchors: see highlight matrix. Sidebar filter/sort chips: fill on hover.

**Focus states.** Keyboard focus must reach every command (proposal §42). Focused buttons get a 0.5px `var(--fm-accent)` ring with 2px offset. Focused cards behave identically to mouse-focused cards.

---

## State Management

The prototype keeps everything in a single `<FMApp>` component for clarity. In production, split:

| State | Owner | Persisted to |
|-------|-------|--------------|
| `comments[]` (array of comment objects, includes `floating` flag) | Document model | The .md file (round-tripped through the YAML serializer) |
| `focused` (comment id or null) | Document view | Memory only |
| `viewMode` ("rendered" / "source") | Document view | Memory only (per-document) |
| `composer` (`{anchorId, rect, mode, draft}` or null) | Document view | Memory only |
| `filter`, `sort` | Sidebar | Memory only |
| `reattachTarget` (comment id or null) | Document view | Memory only |
| `conflict` (`{kind, externalDelta, localDelta}` or null) *(NEW)* | Document view | Memory only |
| `modified` | Document model | Memory only (drives save-on-close) |
| `theme` ("light" / "dark" / "system") | App preferences | App preferences (Tauri store) |
| `fontSize` (14–22) | App preferences | App preferences |
| `authorName` (string) | App preferences | App preferences |
| `recentFiles[]` (max 10) | App preferences | App preferences |

> **Sidebar filter dropdown.** The prototype hardcodes `By Claude` as a filter option. **Production must populate this dynamically from the actual `author` field of comments in the file** — a `Set` of distinct authors plus the user's own name as `By me`. The order: "All comments / Open only / Resolved / By me / By <author>...". Don't carry the hardcoded list forward.

**Document model.** Parse `.md` on open into `{ body: string, comments: Comment[] }`. Serialize on save (debounced 500ms after last change, or on ⌘S / window close).

**Round-trip parity (CRITICAL).** Before any UI is built on top of the parser, the YAML parser/serializer must produce **byte-equivalent output** for a representative set of input files (see implementation order step 3.5). This is the kind of thing that's painful to discover later.

**File watching.** Tauri's `tauri-plugin-fs-watch`. When the underlying file changes externally, run anchor reattachment (proposal §185) and route to the appropriate conflict surface ([§11](#11-file-conflict-banner-and-modals)).

---

## Comment object schema

(From the proposal — reproduced here for convenience, with `floating` added in v1.1)

```typescript
interface Comment {
  id: number;                // Sequential, starts at 1
  anchor_text?: string;       // The text wrapped between the inline markers.
                              // Optional only when `floating: true`.
  context_before?: string;    // ~1 sentence before the anchor (for orphan recovery)
  context_after?: string;     // ~1 sentence after (for orphan recovery)
  author: string;             // Free-form name. Humans set in prefs; AI agents pick their own.
  timestamp: string;          // ISO 8601 UTC
  edited_at?: string;         // ISO 8601 UTC, set on edit
  body: string;               // The comment text
  replies: Comment[];         // Nested comments
  resolved: boolean;
  floating?: boolean;         // NEW in v1.1. When true, the comment has no inline marker.
                              // Card lives in the sidebar's Floating notes section.
  state?: "unread" | "read" | "has-unread-replies"; // UI-only; not serialized
  suggested_edit?: { from: string; to: string };
  orphaned?: boolean;         // UI-only; computed on file open
}
```

Notes:
- `state` and `orphaned` are UI-derived flags, not part of the on-disk schema.
- `floating` *is* serialized — it's a steady-state, not a transient computed flag.

---

## AI Authorship — Important

**No badges. No glyphs. No "AI" sidebar tab. Same avatar treatment as human authors.** The brief is explicit (pillar #3: AI authors are first-class). The only signal that distinguishes Claude's comment from Maya's is the name. Do not invent visual treatments here. The author-filter handles "show me only human comments" without the design taking a position.

> **TODO marker for v1.1+:** the brief's open question 4 ("body-edit diff view when an AI agent has edited prose alongside its comments") is **skipped for v1**, but worth a `// TODO(forgemark-v1.1): body-edit diff` marker wherever the file watcher reconciles an external change. When AI-driven body edits become more common, that's the place where a diff overlay would hook in.

---

## What's NOT In This Bundle

- **Application icon (.icns / .ico).** Wordmark candidates are in the design system canvas under **Wordmark candidates**; production export is a build-pipeline task (1024×1024 master rendered into the standard icon-stack sizes — Apple Human Interface Guidelines).
- **Final sample annotated file content.** `sample-doc.jsx` is the prototype's fixture; the production sample file (the one users land in on first run) needs to be written by you/the design author. Suggested shape: a 400–600-word piece of prose (a product brief, a memo, or an essay) with **5 comments** — 2 from a human, 2 from `Claude`, 1 suggested-edit thread. One should be a thread with a reply. None should be resolved (we want the user to learn how to resolve them).
- **Body-edit diff view.** Skipped per direction in the brief's open question 4. See TODO marker note above.
- **Multi-document file switcher.** v1 ships single-document — confirmed by review. Use ⌘O and Open Recent (max 10).
- **Concurrent multi-author editing.** Out of scope for v1 per the brief.
- **In-app undo for terminal actions** (Accept, Reject, Discard). Worth a v1.1 follow-up.
- **Animations beyond the hairline transitions noted above.** Use codebase conventions.

---

## Implementation Order (Suggested, revised)

1. **App shell + theme tokens.** Title bar, sidebar, editor pane scaffold. Light/dark theme switching wired to `prefers-color-scheme` + Tauri appearance API.
2. **Document model + GFM rendering.** Parse the file, render prose. No comments yet.
3. **Comment YAML parser/serializer + inline-marker walker.** Extract from raw markdown into `Comment[]`.
3.5 **Round-trip fixture milestone *(NEW)*.** Before any UI is built on top of the parser, it must produce byte-equivalent output for a representative fixture set. Build a test that opens N annotated `.md` files, parses + serializes them, and asserts byte-equivalence. **Block step 4 on this passing.** Painful to discover later.
4. **`<Anchor>` wrapper + `<FMCard>`.** Default + read state only. Click-to-focus.
5. **Composer (new comment).** ⌘⌥M selection-to-comment.
6. **All card states.** Unread, has-unread-replies, focused, resolved, edit, reply, **floating note**.
7. **Suggested edits.** Composer toggle, accept/reject behavior — both terminal per proposal §117.
8. **Source view.** Per-document toggle, marker visibility, "read-only review" chip.
9. **Lost-anchor recovery.** File-watcher + reattachment strategy + three-option modal (reattach / keep as floating / discard).
10. **File-conflict surfaces.** Banner (clean reload), edit-during-open modal (with unsaved-work disclosure), save-conflict modal (Cancel and inspect / Overwrite).
11. **Native menus, save-on-close, Clean Export, Settings, First-run.**

---

## Confirmations from the dev review (your reading is correct)

- **Avatars are color-derived from a hash of the author name** (deterministic per name, low chroma). AI authors get the same treatment.
- **Suggested-edit Accept** replaces text + removes markers + removes YAML object entirely (terminal).
- **Suggested-edit Reject** is now ALSO terminal — removes markers + YAML object, no `resolved: true` retention. *Revised in v1.1 to match proposal §117.*
- **Inline marker format** is `<!-- fmc:N -->…<!-- /fmc:N -->` with integer IDs.
- **Resolved comment markers** stay invisible (HTML comments) — only the highlight decoration is dimmed (proposal §119).
- **200ms max animations**, no spring physics, no auto-summarize.
- **Resolved-card collapsed preview** strips markdown to plain text. `**Bold** and italic` → `Bold and italic`.
- **Reply ordering** vs sidebar sort: sort applies to top-level threads only; replies inside a thread stay chronological.
- **Open Recent count:** 10 entries (standard macOS).
- **Skill package:** bundled, ~30–60 KB, instant — no progress state.
- **Empty state copy:** "No comments yet." / "Select text in the document to start a review."

---

## Open Questions / Pushback (revised)

Read `Forgemark - Rationale.html` for the four pieces of pushback raised by the design phase **plus the dev-review follow-throughs**:

1. **Source view interaction asymmetry** — accepted as read-mostly; "read-only review" chip added.
2. **Format does not survive deletion of an annotated paragraph** — v1.1 ships **floating notes** (smallest schema change; existing Reattach modal gains a third button). Deletion-time confirmation deferred to v1.1.
3. **Brief is single-document** — confirmed: v1 ships single-document; multi-doc/project drawer in v1.1.
4. **Edit-during-open is undefined** — designed in v1.1: banner ([§11a](#11a-file-conflict-banner-in-editor-pane)) for clean external edits, modal ([§11b](#11b-edit-during-open-modal-when-user-has-unsaved-work)) for unsaved-work reconciliation, separate save-conflict modal ([§11c](#11c-save-conflict-modal-on-s-when-underlying-file-has-changed)) for ⌘S races.

---

*Generated from the Forgemark design phase, revised after AI-developer review. Questions: route through the design author or open issues in the Forgemark repo.*
