# Forgemark Implementation Plan

## 1. Overview

Forgemark is a Tauri-based desktop application for collaborative review of markdown documents by humans and AI agents. The full specification lives in three source documents:

- **Product proposal** — `docs/markdown-commenter-proposal.md`. The canonical spec for file format, schema, and behavior.
- **Design handoff** — `docs/design_handoff_v1_1/`. Visual surface, interactions, and locked design tokens.
- **Design feedback** — `docs/design_feedback_v1_1.md`. Six product calls that fold into the next design pass.

This plan turns those into a phased build with thorough test coverage at each step. AI-agent participation is a first-class user surface, so AI-driven tests are sprinkled across the phases — not reserved for the end. Section 2 below ("AI testing methodology") describes the harness, fixtures, sub-agent usage, and CI policy in detail; phases reference it.

### Stack at a glance

- **Shell:** Tauri 2.x (Rust core + system webview). Native menus, dialogs, file watching, file I/O.
- **UI:** TypeScript + React + CSS Modules. Design tokens consumed from `design_handoff_v1_1/tokens.js` (translated into TS / CSS vars).
- **Markdown rendering:** `unified` + `remark-gfm` + `remark-rehype`.
- **Editor surface:** ProseMirror (via Tiptap) for the rendered editing pane. Marker pairs are represented as **inline nodes** in the ProseMirror doc (part of the document model, no visible glyph). The yellow highlight glow over an anchored span is a separate **decoration** layer that responds to focus/hover state without modifying the doc. CodeMirror 6 for the source view (read-mostly).
- **YAML:** `yaml` (eemeli/yaml) for parse + serialize with formatting preservation.
- **Test runners:** Vitest (TS unit + integration), `cargo test` (Rust unit), Playwright (E2E via Tauri's WebDriver). AI-agent tests run interactively via Claude Code's Agent tool; an optional Anthropic SDK harness exists for batch use but is not in CI by default.
- **CI:** GitHub Actions, matrix on macOS + Windows. AI-agent tests are explicitly NOT in default CI — see §2 CI policy.

### Document model

The application keeps two parallel views of the file in memory:

1. **The serialized form** — a `string` matching exactly what's on disk, including HTML-comment markers and the trailing YAML block.
2. **The structured form** — `{ proseDoc: ProseMirrorDoc, comments: Comment[] }`. The ProseMirror doc carries the prose with marker pairs as inline nodes (no visible glyph; the highlight glow is rendered by a decoration layer); comments live in a separate array.

On open: parse string → structured. On save: serialize structured → string. The serializer is byte-deterministic given the same structured input, which is what makes the round-trip parity test (Phase 3) possible.

Edits go through the structured form. ProseMirror handles selections, decorations (the highlight glow), and marker placement at exact text offsets. All mutations are debounced 500ms before writing back to disk; explicit ⌘S commits immediately.

### Test pyramid

| Layer        | Tool                                                                                 | Coverage                                                                                        |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Unit (TS)    | Vitest                                                                               | Format parser, serializer, anchor walker, fuzzy match, settings, schema validation              |
| Unit (Rust)  | `cargo test`                                                                         | File I/O, file watcher, path normalization, hash computation                                    |
| Integration  | Vitest + jsdom                                                                       | React components in isolation; document-model state transitions; ProseMirror plugin behavior    |
| E2E          | Playwright                                                                           | Full app flows: open file, add comment, save, reload                                            |
| Visual       | Playwright snapshots                                                                 | Theme rendering, card states, modals — separate snapshots for macOS WebKit and Windows WebView2 |
| Round-trip   | Vitest                                                                               | Open `.md` fixture → parse → serialize → assert byte-equivalent                                 |
| **AI-agent** | Claude Code `Agent` (primary, interactive) + optional Vitest + Anthropic SDK harness | Format read/write verification; details in §2                                                   |

### Phasing principles

- Phases are mostly sequential. A few can overlap (e.g. token wiring while markdown rendering is being built).
- Each phase has at least one **gating test** that must pass before the next phase begins.
- **Phase 3 has a hard gate** (round-trip fixture parity). UI work cannot start on top of a parser that doesn't round-trip cleanly.
- AI-agent tests run from Phase 3 onward. Phase 12 builds the bundled skill package and rounds out coverage; it's not the only AI testing phase.

### Pre-flight: proposal updates and initial skill content

Before Phase 0 begins, two prerequisites must land. Both gate the rest of the plan.

**A. Proposal `floating` schema update.** Update `docs/markdown-commenter-proposal.md`:

- _Storage Format / Schema reference:_ add `floating` (boolean, optional) — when true, the comment has no inline marker pair and `anchor_text` may be omitted.
- _Format Spec for AI Authors:_ add a note that an AI agent encountering `floating: true` should not insert inline markers, and may set the flag itself when authoring a comment that has no good anchor.
- _Storage Format_ intro paragraph: mention floating notes are a steady-state, not a recovery state.

**B. Draft `assets/forgemark-skill/SKILL.md`.** This file is needed by Phase 5 onward (the first AI-WRITE tests assume the agent has loaded the skill). The Phase 0 draft is hand-derived from the proposal's Storage Format and Format Spec for AI Authors sections, with the YAML frontmatter (`name: forgemark`, `description: …`). It can refine later as the spec stabilizes; Phase 12 packages and distributes the final version, but the content lives in the repo from day one.

---

## 2. AI testing methodology

This section spells out the harness, fixtures, assertion approach, sub-agent vs SDK split, CI policy, and how to add tests. Phases reference it; readers should treat this section as definitive.

### Why AI tests are first-class

The proposal makes AI agents a co-primary user. An AI's ability to read and write the format correctly is therefore part of the product surface — not a developer ergonomics concern. Tests must verify:

1. AI agents can **read** annotated files and answer questions about them (comment counts, authors, threading, suggestions).
2. AI agents can **write** new comments, replies, suggested edits, and state changes that round-trip through the parser cleanly.
3. AI agents respect the schema (sequential IDs, ISO 8601 timestamps, escape rules, marker placement).
4. AI agents handle the awkward cases (orphan recovery, floating notes, body content with reserved sequences, long files).

### Test architecture

```
tests/
├── ai/
│   ├── harness.ts            ← SDK wrapper + structural assertion helpers
│   ├── fixtures/             ← Annotated .md files. All seven created in Phase 3.
│   │   │                       Reused for round-trip + AI tests + skill examples.
│   │   ├── 01-simple.md
│   │   ├── 02-with-thread.md
│   │   ├── 03-suggestion.md
│   │   ├── 04-orphan-and-floating.md
│   │   ├── 05-resolved-and-edited.md
│   │   ├── 06-escapes.md
│   │   └── 07-empty-body-suggestion.md
│   └── cases/                ← One file per test category, e.g. cases/write-comment.test.ts
│       ├── read.test.ts
│       ├── write-comment.test.ts
│       ├── write-reply.test.ts
│       ├── write-suggestion.test.ts
│       ├── statechange.test.ts
│       ├── recovery.test.ts
│       └── escapes.test.ts
```

The harness reads the skill content directly from `assets/forgemark-skill/SKILL.md` — no copy in `tests/`. Single source of truth.

### Harness

````typescript
// tests/ai/harness.ts
import Anthropic from "@anthropic-ai/sdk";
import { parseForgemarkFile, ParsedFile } from "../../src/format";
import { readFileSync } from "node:fs";

const client = new Anthropic();
const SKILL = readFileSync("assets/forgemark-skill/SKILL.md", "utf-8");
const MODEL = process.env.AI_TEST_MODEL ?? "claude-opus-4-7";

export interface AIAgentTestCase {
  name: string;
  fixturePath: string;
  prompt: string;
  expect: (after: ParsedFile, before: ParsedFile, raw: string) => void;
}

export async function runAIAgentTest(tc: AIAgentTestCase) {
  const beforeRaw = readFileSync(tc.fixturePath, "utf-8");
  const before = parseForgemarkFile(beforeRaw);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SKILL,
    messages: [
      {
        role: "user",
        content:
          "Here is the file:\n\n```markdown\n" +
          beforeRaw +
          "\n```\n\n" +
          tc.prompt +
          "\n\n" +
          "Return the FULL modified file inside a single fenced code block. " +
          "Do not include any other text outside the fence.",
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  const afterRaw = extractFenced(text);
  const after = parseForgemarkFile(afterRaw);

  tc.expect(after, before, afterRaw);
}

function extractFenced(text: string): string {
  // The skill instructs the model to emit one fenced block. Be generous on the fence type.
  const m = text.match(/```(?:markdown|md)?\n([\s\S]+?)\n```/);
  if (!m) throw new Error("AI response did not contain a fenced code block");
  return m[1];
}
````

### Anatomy of a test case

```typescript
// tests/ai/cases/write-comment.test.ts
import { runAIAgentTest } from "../harness";

test("AI adds a comment with the next sequential id", async () => {
  await runAIAgentTest({
    name: "add-comment-on-paragraph",
    fixturePath: "tests/ai/fixtures/01-simple.md",
    prompt:
      'Add a comment on the third paragraph saying "this needs more detail." Author yourself as "Claude".',
    expect: (after, before) => {
      // Structural assertions only — never compare body text directly.
      const newComments = after.comments.filter((c) => !before.comments.some((b) => b.id === c.id));
      expect(newComments.length).toBe(1);
      const fresh = newComments[0];
      expect(fresh.id).toBe(Math.max(...before.comments.map((c) => c.id)) + 1);
      expect(fresh.author).toBe("Claude");
      expect(fresh.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(fresh.body).toMatch(/.+/); // Some body text exists.
      expect(fresh.resolved).toBe(false);
    },
  });
});
```

### Assertions: structural, not text-equality

Models produce slightly different text every run. So tests assert on shape:

- ❌ `expect(comment.body).toBe('Citation added.')`
- ✅ `expect(commentById(after, 1).replies.length).toBe(commentById(before, 1).replies.length + 1)`
- ✅ `expect(commentById(after, 1).replies.at(-1)?.author).toBe('Claude')`
- ✅ `expect(after.comments.find(c => c.id === 1)?.body).toMatch(/citation/i)`

Regex / numeric / shape assertions keep tests stable while still verifying the AI did the right thing.

### Where AI tests run: Claude Code sub-agents, primarily

AI tests are **interactive-first**. The primary execution path is Claude Code's `Agent` tool, which uses the user's Claude subscription rather than metered API credits. Workflow:

1. A developer working on a phase opens Claude Code.
2. They invoke `Agent` with the fixture content + skill content + a test prompt from `tests/ai/cases/<category>.md` (this is a markdown catalogue of the same test cases the harness defines, written so a sub-agent can read it directly).
3. The sub-agent returns the modified file.
4. The developer pastes the result into a small `npm run verify-ai-output -- <case-id>` script that runs the same structural assertions the harness would have run via SDK. The script is local-only, no network calls.
5. If green, the developer captures the run summary in the PR description.

This keeps incremental API cost at **zero** for routine development. The Vitest + SDK harness (described above) is retained as an **optional ad-hoc tool** for batch verification or when a developer wants to run cases without an interactive Claude Code session. It is not wired into CI.

### CI policy

CI **does not run AI tests at all** — not on every PR, not on a label, not on a schedule. Cloud runners have no Claude Code; running the SDK harness there would mean metered API calls. Instead:

- All format-correctness tests CI cares about (parser, serializer, round-trip parity, schema validation, marker-walker, WCAG contrast, etc.) run as plain Vitest / Playwright tests with no AI involvement. These cover the file-format contract end-to-end.
- AI participation is verified manually before merge, with the run summary captured in the PR description by the developer.

The SDK harness exists in the repo for developers who prefer programmatic batch runs locally — invoked with `RUN_AI_TESTS=1 npm run test:ai` and an `ANTHROPIC_API_KEY` in their environment. It is never invoked from CI. No PR labels, no scheduled workflows, no budget alerts — there is no recurring spend to monitor.

### Retry semantics

A flaky retry can mask a real regression. Policy:

- Retry **once** if the SDK call itself errors (network, 5xx, rate limit). This is a transport retry, not a logic retry.
- A test that fails its assertions does **not** retry. Investigate.
- A test marked `.flaky()` gets one logic retry but logs a warning. Used sparingly for tests that are inherently nondeterministic; avoid wherever possible. The `.flaky()` Vitest helper lives at `tests/utils/flaky.ts` (created in Phase 0).

### Fixture inventory

Fixtures live in `tests/ai/fixtures/`. They double as inputs to Phase 3 round-trip tests AND as inputs to AI tests AND as examples shipped in the skill package. **All seven fixtures are created together in Phase 3** — the parser handles every schema variant from day one, so the round-trip parity gate covers the full schema before any UI work begins. Later phases USE these fixtures rather than CREATING them.

| File                          | Coverage                                           |
| ----------------------------- | -------------------------------------------------- |
| `01-simple.md`                | 2 plain comments, no replies, no suggestions       |
| `02-with-thread.md`           | Threaded comment with 2 replies (chronological)    |
| `03-suggestion.md`            | A suggested-edit comment (from/to)                 |
| `04-orphan-and-floating.md`   | One drifted anchor + one floating note             |
| `05-resolved-and-edited.md`   | Resolved + edited (with `edited_at`)               |
| `06-escapes.md`               | Body content containing `-->` and `<!--` (escaped) |
| `07-empty-body-suggestion.md` | Suggestion with no body (body-optional rule)       |

### How to add a new test case

1. Add (or reuse) a fixture in `tests/ai/fixtures/`.
2. Add the prompt + structural expectations to `tests/ai/cases/<category>.md` (the sub-agent-readable catalogue).
3. Spawn a Claude Code sub-agent with the fixture + skill + prompt; iterate until the model's output is stable. No metered cost during this iteration.
4. Once the prompt is stable, mirror the case into `tests/ai/cases/<category>.test.ts` with the `runAIAgentTest` harness call. This entry runs only when a developer locally invokes `RUN_AI_TESTS=1 npm run test:ai`. It is never run in CI.
5. Capture a sample run summary in the PR description so reviewers can see the AI verification ran.

### Verifying with a non-Claude-Code AI

To verify with Codex CLI, ChatGPT, or any other agent:

1. Open the fixture in a text editor; copy the full file contents.
2. Open the target AI tool.
3. Paste `assets/forgemark-skill/SKILL.md` first as system context (Codex: install the `.skill` package), then the fixture.
4. Send a prompt from the relevant test category catalogue (`tests/ai/cases/<category>.md`).
5. Run the result through `npm run verify-ai-output` to apply the same structural assertions automatically.

### Test categories (defined incrementally per phase)

| Category             | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| AI-READ              | Comment comprehension, schema literacy, threading            |
| AI-WRITE-comment     | Adding new comments with correct ID + markers + schema       |
| AI-WRITE-reply       | Adding replies; chronological ordering; attribution          |
| AI-WRITE-suggestion  | Suggested edits, accept/reject lifecycle, body-optional rule |
| AI-WRITE-statechange | Resolve, unresolve, delete, edit own comments                |
| AI-RECOVERY          | Orphan-to-floating conversion, lost-anchor scenarios         |
| AI-ESCAPES           | Body content with `-->` and `<!--`                           |

Counts are not pre-committed. Each category gets enough cases to cover its concerns; the suite grows naturally as phases land.

---

## 3. Phases

### Phase 0 — Project bootstrap

**Goal:** a Tauri shell that builds and launches with React + TS + the test toolchain wired. Proposal `floating` schema update committed. Initial draft of `SKILL.md` committed.

**Deliverables**

- Pre-flight A: proposal updated to add `floating` field (see §1 Pre-flight).
- Pre-flight B: initial `assets/forgemark-skill/SKILL.md` drafted from the proposal's Storage Format and Format Spec for AI Authors sections.
- `tauri-cli` initialized; `src-tauri/` with a minimal Rust main; `src/` with a React + TS entry point.
- `package.json` scripts: `dev`, `build`, `test`, `test:e2e`, `test:ai`, `lint`, `format`.
- `tsconfig.json`, ESLint + Prettier, EditorConfig.
- Vitest + jsdom + Playwright + Anthropic SDK installed.
- `tests/utils/flaky.ts` helper for the AI-test retry policy (see §2 retry semantics).
- GitHub Actions workflow: `.github/workflows/ci.yml` — lint + unit + E2E + round-trip parity on macOS; lint + unit on Windows. **No AI-agent tests in CI, ever** (see §2 CI policy). This is the only workflow file in the repo.
- `// TODO(forgemark-v1.1)` comment convention documented in CONVENTIONS.md.
- Single repo README at the project root, updated with build / test instructions. The same file evolves through phases; Phase 13 adds the public-facing release content (install, screenshots, license).

**Tests**

- _Smoke (E2E):_ `npm run dev` opens a Tauri window without console errors. Title bar reads "Forgemark — Untitled".
- _Smoke (unit):_ a trivial Vitest assertion runs in < 200 ms.
- _CI:_ both jobs green on a feature branch.
- _Proposal update:_ the modified proposal renders correctly and the schema reference includes `floating`.
- _Skill content sanity:_ `assets/forgemark-skill/SKILL.md` exists, has valid YAML frontmatter, and is < 4000 tokens (rough count by word-token estimate; tightened in Phase 12).

**Acceptance**

- `npm run dev` opens a Tauri window on macOS.
- Vitest, Playwright, and the AI test scaffold are wired (the AI test scaffold can be empty at this point — just a passing placeholder).
- The proposal includes `floating`; `assets/forgemark-skill/SKILL.md` exists and is consistent with the proposal.

---

### Phase 1 — Theme tokens & app shell

**Goal:** the app shell from the design — title bar, sidebar, editor pane scaffold — themed with locked tokens.

**Deliverables**

- Translate `design_handoff_v1_1/tokens.js` to TS + CSS custom properties at `src/theme/tokens.ts`.
- Light + dark theme switcher (`prefers-color-scheme` + manual override via Tauri appearance API).
- App shell layout: 44px combined chrome (Tauri-native traffic lights, centered file name, segmented control + sidebar toggle on the right) + body (editor pane left, 320px sidebar right).
- Empty editor pane with the document max-width (720px centered).
- Empty sidebar with header (count placeholder + filter + sort dropdowns; populate later).

**Tests**

- _Unit:_ `tokens.ts` exports light + dark token sets that match `tokens.js` byte-for-byte (a contract test).
- _Unit (WCAG AA contrast):_ programmatically check that every text-on-background token pair meets WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI components) in both themes. Fail CI on regression.
- _Integration:_ render `<AppShell />` with light theme, assert the editor pane and sidebar widths.
- _Visual snapshot (macOS WebKit + Windows WebView2):_ light + dark shells side-by-side. Re-baseline on intentional changes.
- _Manual:_ eyeball the shell against `Forgemark.html` prototype on both themes.

**Acceptance**

- App opens with the design's chrome on macOS in both themes.
- Resizing the window keeps the sidebar pinned at 320px and the editor centered with 720px max content width.
- All token pairs pass WCAG AA contrast in both themes.
- No console warnings.

---

### Phase 2 — Markdown rendering & document model

**Goal:** open an arbitrary `.md` file, render it as GFM in the editor pane via ProseMirror.

**Deliverables**

- ProseMirror (via Tiptap) integrated as the editor for the rendered view. GFM extensions (headings, lists, tables, code blocks, links, images, footnotes).
- File-open via Tauri `dialog.open` and `fs.readTextFile`.
- Mode toggle (Rendered / Source) in the title bar; Source view shows raw markdown text in `var(--fm-mono)` 13/1.65 (no syntax highlighting yet — defer to Phase 8).
- "Untitled" / file-name title-bar state; modified-dot infrastructure (becomes meaningful in Phase 5 when the first composer submit dirties the document; in Phase 2 it tracks any prose-edit dirtiness too).
- Save: ⌘S writes the current file. Auto-save fires on any document edit after a 500ms quiet period.

**Tests**

- _Unit:_ render a fixture markdown file (headings, lists, tables, code blocks, links) into the ProseMirror doc and assert the doc tree contains expected nodes.
- _Integration:_ open a file via the menu, assert the editor pane fills with rendered prose.
- _Integration (file I/O edge cases):_ opening a read-only file shows the editor in read-only mode (toolbar disabled). Opening a file that no longer exists on disk shows a polite error and returns to the prior state. Opening a path that's a directory or non-markdown file is rejected at the dialog filter.
- _E2E:_ click File → Open, pick a fixture, see it render. Toggle Source view, see raw text.
- _Performance:_ render a 30,000-word markdown file in < 250 ms (rough; tighten later).

**Acceptance**

- A markdown fixture renders with all GFM features. Source view shows the same file's raw text.
- Mode toggle is per-document. ⌘S writes the file unchanged for a no-edits session.
- Read-only and missing-file edge cases handled gracefully.

---

### Phase 3 — Comment storage layer (parser + serializer + marker walker) ⭐ HARD GATE

**Goal:** parse and serialize the Forgemark file format losslessly. Round-trip parity is the hard gate before Phase 4.

**Deliverables**

- `parseForgemarkFile(input: string): { body: string; comments: Comment[] }` — extracts the trailing `<!-- forgemark-comments` block, parses the YAML, walks the body for paired markers, validates the schema.
- `serializeForgemarkFile({ body, comments }): string` — emits the body unchanged + a single trailing HTML comment containing the YAML block. **No empty block on save when `comments.length === 0`.**
- Escape rules in user-content fields: `-->` ↔ `--\>`, `<!--` ↔ `<!\--`. Symmetric on parse.
- Schema validation; helpful errors. Unknown fields preserved on round-trip (forward compatibility per the proposal's Storage Format / Forward compatibility paragraph). Floating-note comments (`floating: true`, `anchor_text` optional) handled. **Validation rule: `anchor_text` is required unless `floating: true`.**
- TypeScript types matching the proposal's schema reference (with `floating?: boolean`).
- Marker-walker rule: **markers inside fenced code blocks and inline code spans are NOT parsed as anchors** — the walker only looks at AST nodes outside code regions.
- **YAML serialization determinism.** Pin the `yaml` library config (key ordering = source order, quoting style = preserve, line width = ∞, indent = 2) so round-trip is bytewise stable. If the library can't preserve formatting predictably for our schema, write a thin custom serializer that emits comments in id-order with a fixed quoting policy. The choice between library-pinned and custom is made during this phase based on a spike; either way, the serializer's output is byte-deterministic given the same input.
- **All seven fixtures created** in `tests/ai/fixtures/` (see §2 fixture inventory). Each fixture is hand-written by an engineer to match its coverage description; together they exercise the full schema surface.

**Tests (unit, integration, round-trip)**

- _Unit (parser):_ exhaustive case coverage — empty file, no comment block, single comment, threaded replies, suggested edits, floating notes, unknown fields, malformed YAML, unmatched markers (one of pair missing), markers inside code blocks (must be ignored), escape sequences in body, file with content but no trailing newline.
- _Unit (schema validation):_ explicit assertion that `anchor_text` is required when `floating` is unset/false, and optional when `floating: true`. Both directions tested.
- _Unit (marker / YAML consistency):_ three explicit invariants —
  - Comment IDs are unique within a file. Two YAML records with `id: 1` fail validation.
  - Every YAML record with `floating !== true` has a matching `<!-- fmc:N --> ... <!-- /fmc:N -->` pair in the body. A YAML record with no marker pair (and not floating) fails validation.
  - Every marker pair in the body has a matching YAML record. A marker `<!-- fmc:7 -->` with no `id: 7` in YAML fails validation.
- _Unit (serializer):_ round-trip every parser fixture (parse → serialize → parse again, assert deep equality on the comment array).
- ⭐ **_Round-trip parity (CRITICAL):_** for **every fixture present in `tests/ai/fixtures/` at this point** (all seven, since they're created in this phase), parse → serialize → assert **byte-equivalent output**. Phase 4 cannot start until this is green.
- _Property-based:_ fast-check generator producing random valid Comment objects → serialize → parse → assert deep equality.
- _Marker-placement edge cases:_ selections that span paragraphs, span list items, include inline formatting (bold/italic/code), are entirely within a code block (rejected), are inside inline code (rejected).

**Tests (AI-agent)**

- _AI-READ-01:_ Give a no-skill model `01-simple.md` and ask "How many comments are open vs resolved? Who authored each?" Expect correct counts and authors.
- _AI-READ-02:_ Give a no-skill model `02-with-thread.md` and ask "Summarize the discussion in the thread on paragraph 1." Expect mention of both replies in chronological order.

These two AI tests verify the format is **legible to AI agents without skill aid** — a baseline check that the format itself isn't pathological.

**Acceptance**

- Every fixture file round-trips byte-equivalent.
- Property-based test passes 1000 iterations.
- Unknown fields survive a round trip.
- Markers inside fenced and inline code are not parsed as anchors.
- Both AI-READ baseline tests pass.

---

### Phase 4 — Anchor + Card components (default + read state)

**Goal:** render comments visually next to their anchored passages.

**Deliverables**

- `<Anchor>` ProseMirror inline node — renders a span around the anchored prose with the highlight-state CSS class.
- A ProseMirror plugin that converts paired marker pairs in the source into `<Anchor id={N}>` inline nodes on parse and back to markers on serialize.
- `<FMCard>` component with default + read state. Author row, body, replies (rendered if any), deterministic-color avatar (hash of author name).
- Sidebar populates from parsed comments, sorted by document position.
- Click-to-focus: clicking a card shifts both card and anchor into the focused state. No composer yet.
- Hover symmetry: hovering an anchor in the prose hovers the corresponding card; vice versa.

**Tests (integration, visual, accessibility)**

- _Integration:_ render a fixture file, assert the right number of cards in the sidebar and the right number of `<Anchor>` nodes in the prose. Assert order matches document position.
- _Integration (focus):_ click a card, assert anchor highlight changes to focused state. Click the anchor, assert card highlights.
- _Integration (anchor wrapping inline formatting):_ an anchor whose span contains bold + italic + inline code + a link renders correctly — the highlight wraps the full span without breaking children, and the children remain styled correctly. Test each combination.
- _Visual snapshot:_ card states (default, focused, has-unread-replies) on macOS + Windows.
- _Accessibility (keyboard reachability):_ every card-level action (focus, expand thread, scroll-to-anchor) is reachable via keyboard alone — no mouse-only paths.
- _Accessibility (focus rings):_ focused card and focused button render the design-spec'd focus ring (0.5px accent ring, 2px offset). Visible in both light and dark themes.
- _Accessibility (screen reader):_ keyboard navigation moves focus through cards in document order; focused card is announced with author + first ~30 chars of body.

**Acceptance**

- Opening a fixture file renders all comments correctly bound to their passages.
- Click-to-focus and hover-symmetry both work.
- Tab cycles through cards in document order.

---

### Phase 5 — New-comment composer

**Goal:** select text in the rendered view → composer → submit → markers + YAML inserted → file marked dirty → save persists.

**Deliverables**

- Composer floats beside the selection, anchored to selection bounds (max 360px wide).
- Submit (⌘↵ / button), Cancel (Esc).
- On submit: generate next sequential integer ID; insert paired markers around the selection in the ProseMirror doc; append a Comment YAML object with `anchor_text`, `context_before`, `context_after`, `author` (from prefs), `timestamp` (ISO 8601 UTC); mark dirty.
- **Empty-body validation:** the Submit button is disabled while the textarea is empty or whitespace-only. ⌘↵ does nothing in that state. (Plain comments require non-empty body per the schema. Suggestions with `suggested_edit` allow empty body, handled in Phase 7.)
- Native selection persists during composer interaction.
- 500ms debounce active: a typed comment auto-saves to disk after the user stops typing for 500ms.

**Tests (integration, E2E, round-trip)**

- _Integration:_ select text via test API, trigger composer, type body, submit, assert document body has new markers and comments array has the new entry with correct fields.
- _Integration (ID assignment):_ file with comments [1, 2, 5] gets a new comment with id=6, not 3.
- _Integration (escape rules):_ selecting text containing `-->` produces correctly escaped `anchor_text` on serialize.
- _Integration (auto-save):_ typing into a composer triggers a save 500ms after the last keystroke; ⌘S triggers immediately.
- _Integration (empty-body validation):_ opening a composer and pressing ⌘↵ before typing does nothing; Submit button is disabled. Typing a non-whitespace character enables Submit.
- _Integration (code-block selection rejection):_ selecting text inside a fenced code block or inline code span and triggering ⌘⌥M / right-click → New Comment is a no-op. The composer does not appear and the keyboard shortcut produces no audible feedback. Mirrors the parser-level rejection from Phase 3.
- _E2E:_ full flow in Playwright — open fixture, select word, ⌘⌥M, type, ⌘↵, save, reopen, assert comment persists.
- _Round-trip:_ every test that adds a comment ends with a parse → serialize → parse cycle that asserts identity.

**Tests (AI-agent)**

- _AI-WRITE-comment-01:_ Give the agent (with skill) `01-simple.md` and ask to add a comment on a specific paragraph. Verify resulting file has one new comment with id = max+1, correct markers, ISO 8601 timestamp.
- _AI-WRITE-comment-02:_ Same fixture, ask the agent to add three comments at once. Verify IDs are sequential without collision and the file round-trips.
- _AI-WRITE-comment-03:_ Ask the agent to add a comment whose body contains the literal string `-->`. Verify the escape was applied and the file remains parseable.

**Acceptance**

- Adding a comment to a fixture file produces a file that round-trips cleanly.
- All three AI-WRITE-comment tests green.

---

### Phase 6 — All card states & interactions

**Goal:** complete the comment-card interaction surface.

**Deliverables**

- `unread` / `read` / `has-unread-replies` state tracking (UI-only, not serialized).
- Reply composer (nested under focused card; same submit semantics).
- Edit composer (own comments only — match by `author` name).
- Resolve / Unresolve.
- Delete (open to any reviewer; removes YAML object + markers).
- Sidebar filter populates dynamically from comment authors + "By me".
- Sort: Doc order / Newest / Oldest. Replies stay chronological inside threads regardless of top-level sort.
- Keyboard: ⌘R reply, ⌘⏎ resolve when card focused, ⌘⇧E edit own, Delete key on focused card.

**Tests (integration, E2E, performance)**

- _Integration:_ state transitions for each interaction; assert YAML schema after each.
- _Integration (permissions):_ edit affordance hidden when `comment.author !== preferences.authorName`. Delete affordance always visible.
- _Integration (cascade delete):_ deleting a comment that has replies removes the parent YAML object AND its inline marker pair AND every reply atomically. The file remains valid; round-trip succeeds.
- _Integration (filter):_ author "Claude" appears as filter option only when there are comments by Claude.
- _Integration (sort):_ setting sort to Newest reorders top-level cards by `timestamp` desc; replies inside each thread stay chronological.
- _Performance (sidebar virtualization):_ render a fixture with 200 comments; assert only ~30 cards mount at any time (virtualization kicks in above 50 per design).
- _Performance (typing latency):_ with 200 comments loaded, typing in a composer keeps p99 keystroke latency < 16 ms.
- _E2E:_ reply, edit, resolve, unresolve, delete — assert each persists across save+reopen.
- _Round-trip:_ after each interaction.

**Tests (AI-agent)**

- _AI-WRITE-reply-01:_ Ask the agent to reply to a specific comment. Verify the reply lands in the right thread, has correct attribution, sits in chronological position.
- _AI-WRITE-statechange-01:_ Ask the agent to resolve all comments by a given author. Verify only those comments have `resolved: true`; others untouched.
- _AI-WRITE-statechange-02:_ Ask the agent to delete a specific comment by its content (e.g. "delete the comment about citations"). Verify the YAML object and inline markers both gone.
- _AI-WRITE-statechange-03:_ Ask the agent to edit its own previous comment. Verify `edited_at` is set; original `timestamp` unchanged.

**Acceptance**

- All card-state matrix entries from `design_handoff_v1_1/README.md` §3 are reachable and look correct.
- Edit is gated to author; delete is not.
- Sidebar virtualization kicks in above 50 cards with no perceptible latency.

---

### Phase 7 — Suggested edits

**Goal:** suggest-edit composer + accept/reject lifecycle (both terminal per the proposal's Storage Format / Suggested-edit acceptance section).

**Deliverables**

- "Suggest edit" toggle in the composer swaps the textarea for stacked Original (read-only) + Replacement (editable) fields.
- Suggested-edit cards render strikethrough/insertion preview.
- **Accept:** replace `from` with `to` in the body, remove the inline marker pair, remove the YAML object. Card fades out.
- **Reject:** remove the inline marker pair, remove the YAML object. **Terminal — no `resolved: true` retention.**
- Body field is optional when `suggested_edit` is present.
- **Reply hidden on suggestion cards.** The Reply affordance does not appear on suggested-edit cards. Suggestions are terminal (Accept or Reject), so threading on them adds no value. The schema retains the `replies` field on suggestions for forward compatibility (an external file with replies on a suggestion still parses); the UI does not surface it.
- **`from` mismatch handling.** When a user clicks Accept on a suggestion whose `from` text no longer matches the currently anchored text (drift between creation and accept), the suggestion is **routed to the lost-anchor flow** (Phase 9) — the comment is flagged orphaned, the user is prompted to reattach. This reuses the orphan-recovery path rather than introducing a separate mismatch surface.

**Tests (integration, E2E, round-trip)**

- _Integration:_ accept replaces text and strips the comment; assert body and comments after.
- _Integration:_ reject leaves text alone and strips the comment; assert body unchanged but comment removed.
- _Integration:_ suggestion with no body parses and serializes correctly.
- _Integration (no Reply on suggestion):_ a suggested-edit card does not surface the Reply button; ⌘R when a suggestion is focused is a no-op.
- _Integration (reply field round-trips on suggestions):_ a suggestion fixture that already has `replies: [...]` parses and serializes cleanly without dropping the field, even though the UI doesn't expose it.
- _Integration (`from` mismatch routes to lost-anchor):_ a fixture where the suggestion's anchored text has been edited (so `from` no longer matches the anchored span) — clicking Accept routes the comment to the lost-anchor section instead of accepting; user is prompted to reattach.
- _E2E:_ full suggest → accept; full suggest → reject.
- _Round-trip:_ before and after each action.

**Tests (AI-agent)**

- _AI-WRITE-suggestion-01:_ Ask the agent to suggest a wording change on a specific passage. Verify `suggested_edit.from` matches the anchored text and `to` is non-empty.
- _AI-WRITE-suggestion-02:_ Ask the agent to accept the suggested edit in a fixture. Verify body has been updated, marker pair gone, YAML object gone.
- _AI-WRITE-suggestion-03:_ Ask the agent to reject. Verify body unchanged, marker pair gone, YAML object gone (terminal).

**Acceptance**

- Both Accept and Reject are terminal — the comment is gone from the file.
- A suggestion with no body is valid.

---

### Phase 8 — Source view (read-mostly)

**Goal:** raw markdown source rendering with dimmed markers and the "read-only review" chip.

**Deliverables**

- CodeMirror 6 instance for source view, with markdown syntax highlighting (the _outer_ markdown layer only — embedded fenced code blocks (e.g., a ```python block) render as plain mono text. Per-language highlighting inside fenced code is **out of scope for v1**; revisit if reviewers ask for it).
- Dim `<!-- fmc:N -->` and `<!-- /fmc:N -->` markers.
- Subtle background tint on the trailing `<!-- forgemark-comments` block.
- Sidebar interactions still work in source view: click card → scroll source to matching marker.
- Selection-to-comment is **disabled** in source view. The "Source view · read-only review" chip appears in the editor pane's top-left with hover tooltip.
- Per-document mode (memory only); default `Rendered` per Settings.

**Tests (integration, E2E)**

- _Integration:_ toggle source view, assert raw text renders with dimmed markers.
- _Integration:_ attempting to add a comment from source view is a no-op (keyboard shortcut and menu item disabled).
- _Integration:_ clicking a card scrolls source to the corresponding marker.
- _E2E:_ toggle persists per-document but resets on file open.

**Acceptance**

- Source view is fully readable, markers are visible-but-quiet, no accidental comment-adds.

---

### Phase 9 — Lost-anchor recovery + floating notes

**Goal:** when the file's been edited externally (or by an AI agent), recover anchors that have drifted; offer floating-note as a third path. Build the file-watcher infrastructure here; Phase 10 reuses it.

**Deliverables**

- Tauri `tauri-plugin-fs-watch` integrated. Shared **conflict-detection pipeline**: content-hash with mtime fast-path. Mtime unchanged → skip. Mtime changed → hash both versions; only fire if hashes disagree.
- Reattachment strategy (per the proposal's Comment Storage and Diffing section):
  1. Both `<!-- fmc:N -->` markers present → use them.
  2. Else exact `anchor_text` match + matching `context_before` / `context_after`.
  3. Else fuzzy match (token-level Levenshtein) within a context window.
  4. Else flag as orphaned.
- In-document banner ("N comments lost their anchors") with **Recover…** button.
- Sidebar `LOST ANCHOR · N` section pinned to top.
- **Three-option Reattach modal** (per design v1.1 + feedback §2):
  1. **Reattach here** — re-anchor to selected candidate.
  2. **Keep as floating note** — set `floating: true`, drop markers, keep YAML object.
  3. **Discard comment** — remove YAML object entirely.
- Floating-note card variant + `FLOATING NOTES · N` sidebar section.
- **Floating-note action row includes Edit when own comment** (per v1.1 feedback §4).
- **Banner / chip stacking:** if both the lost-anchor banner (this phase) and the source-view "read-only review" chip (Phase 8) would be visible, the banner sits above the prose at the top of the editor pane and the chip sits _below_ the banner in the same top region. The banner is wider (720px max) and the chip is compact, so they don't overlap horizontally; vertical stacking is sufficient.

**Tests (unit, integration, round-trip, performance)**

- _Unit (reattachment):_ test each step of the strategy independently. Edge cases: `anchor_text` matches but no markers; markers present but `anchor_text` mismatched (drift); no candidates at all (orphan); multiple candidates above threshold (modal lists all).
- _Unit (conflict detection):_ mtime unchanged → skip. Mtime + hash both differ → fire. Mtime changed but hash unchanged → skip.
- _Integration (orphan flow):_ simulate external edit that breaks anchors, assert orphan section appears, click Recover, choose Keep as floating note, assert YAML has `floating: true` and no markers in body.
- _Integration (reattach):_ simulate drift, choose Reattach here on best candidate, assert markers re-inserted around new passage and `anchor_text` updated.
- _Integration (discard):_ choose Discard, assert YAML object gone, file dirty.
- _Performance (fuzzy-match at scale):_ a 50,000-word body with 50 orphaned anchors completes the full reattachment pass (markers absent, `anchor_text` exact match attempted, fuzzy fallback) in < 2 seconds on a base M1. Naive token-level Levenshtein won't meet this; the implementation likely needs a candidate-narrowing prepass (e.g. n-gram filter) before the edit-distance step.
- _Round-trip:_ before and after each path.

**Tests (AI-agent)**

- _AI-RECOVERY-01:_ Spawn a sub-agent and ask it to "extensively rewrite the second paragraph" of a fixture file. Reload the result in the app's parser and verify the affected comment is flagged as orphaned (the strategy correctly detects drift).
- _AI-RECOVERY-02:_ Ask the agent to convert an orphaned comment to a floating note (set `floating: true`, remove `anchor_text` and inline markers). Verify the resulting file is valid and the comment is correctly classified.
- _AI-RECOVERY-03:_ Ask the agent to delete a paragraph entirely that has comments anchored to it. Verify the resulting file leaves the comment block intact (the AI didn't aggressively prune); reload in the app and verify the lost-anchor flow surfaces correctly.

**Acceptance**

- Editing the file externally with an editor that breaks anchors triggers the banner and orphan section.
- All three Reattach modal paths work and produce valid files.
- Floating notes round-trip through save/reopen.
- All three AI-RECOVERY tests pass.

---

### Phase 10 — File-conflict surfaces

**Goal:** handle concurrent external edits (file watcher fires) and save races (⌘S after external edit). **Reuses the file-watcher and conflict-detection pipeline from Phase 9.**

**Deliverables**

- **File-conflict banner** (per design v1.1 §11a) — clean reload, no unsaved work. Two buttons: Keep your version, Reload from disk. **No `×` dismiss** (per v1.1 feedback §5).
- **Edit-during-open modal** (§11b) — when the user has unsaved work. Summary line ("1 open composer, 2 edited cards, 1 unsent reply"). **No "Show details" disclosure** (per v1.1 feedback §3). Buttons: Reload from disk, Keep your version, Cancel.
- **Save-conflict modal** (§11c) — on ⌘S when the file has changed on disk. Comparison strip with **two diff signals only**: comments added/removed and body bytes changed. "Unknown changes" fallback when neither is computable. **Cancel** + **Overwrite disk version** (per v1.1 feedback §1, §2). No diff drawer.
- All three surfaces use the same Phase 9 detection pipeline; they differ only in _which_ surface appears based on `(hasUnsavedWork, userInitiatedSave)`.

**Tests (unit, integration, E2E)**

- _Integration (banner):_ simulate external write while no unsaved work; banner appears with two buttons.
- _Integration (modal):_ simulate external write while composer is open; edit-during-open modal appears; verify summary line counts unsaved items correctly.
- _Integration (save-conflict):_ simulate external write, then attempt ⌘S; modal appears with two-signal diff; Cancel returns to editor with banner; Overwrite writes our version.
- _Integration (save-conflict Cancel state):_ after clicking Cancel on the save-conflict modal, the file remains dirty, the file-conflict banner is visible, the user can keep editing. A subsequent ⌘S re-opens the modal (the user's choice was "not now," not "permanently overwrite").
- _Integration (Reload from disk fully replaces state):_ with comments resolved locally and a different set of comments unresolved on disk, choosing Reload from disk produces a state that exactly matches the on-disk file (comments, resolved flags, sidebar order, sidebar filter unchanged). Round-trip the reloaded state to confirm no leftover memory.
- _Integration (false-positive avoidance):_ a touch-save (mtime change, content unchanged) does NOT trigger any surface.
- _E2E:_ full round-trip through each surface.

**Tests (AI-agent)**

- _AI-CONFLICT-01:_ Open a fixture in the app, then have a sub-agent modify the on-disk version externally (add comments, edit prose). Verify the file-conflict banner appears and choosing Reload picks up the agent's changes correctly.

**Acceptance**

- All three conflict surfaces fire under the right conditions and not otherwise.
- Spurious mtime changes don't surface a banner.

---

### Phase 11 — App chrome polish + production sample file

**Goal:** complete the surface — native menus, save-on-close, Settings, first-run, Clean Export. **Production sample file written and shipped.**

**Deliverables**

- Native macOS menu bar via Tauri. Every command from `design_handoff_v1_1/README.md §8`.
- Save-on-close prompt (Tauri dialog) when modified.
- Settings window: Author name, Theme, Font size, Default view. The AI Participation section ships in Phase 12; in Phase 11 it is laid out as an empty section header ("AI Participation") with a single muted placeholder line ("Skill download arrives with a future build.") so the navigation chrome is correct and Phase 12 only needs to drop in the two download buttons.
- **Production sample file** at `assets/sample-onboarding.md` — 400–600 word piece with 5 comments (2 human, 2 Claude, 1 suggested-edit), one threaded reply, none resolved.
- First-run: Forgemark glyph + name field; Skip / Open sample → buttons. Lands user in the production sample file.
- Clean Export confirmation modal → native save panel → emits comment-free `.md`.
- Open Recent (10 entries) persisted via Tauri store.

**Tests (integration, E2E)**

- _Integration:_ every menu item routes to the correct action.
- _Integration:_ settings persist across app restart.
- _Integration:_ Clean Export emits a file with no inline markers and no trailing comment block.
- _Integration (sample file):_ the production sample file parses cleanly, round-trips, and renders all comment states correctly (read, has-unread-replies, suggestion).
- _Integration (Open Recent stale entries):_ an Open Recent entry whose file has been moved or deleted shows in the menu (we don't validate at menu-build time); clicking it shows a polite error toast ("File no longer exists at <path>. Remove from recent files?") with a Remove button that drops it from the list.
- _Integration (Author Name change behavior):_ changing Author Name in Settings affects new comments only — existing comments retain their original `author` field. Specifically: open a fixture with an existing comment by "Maya"; change Author Name to "Jordan"; the existing comment still shows "Maya" in the sidebar and YAML; a newly added comment shows "Jordan".
- _E2E:_ full first-run → set name → see sample file → add a comment → save → quit → reopen, name persists.

**Tests (AI-agent)**

- _AI-SAMPLE-01:_ Run the production sample file through every read/write AI test category. Verify it works as a representative example for the skill package.

**Acceptance**

- Every command in the menu bar is reachable via mouse and keyboard.
- Settings round-trip across app restart.
- Clean Export produces a comment-free copy.
- Production sample file works end-to-end.

---

### Phase 12 — Skill package + complete AI test coverage

**Goal:** ship the bundled skill package; round out AI tests; gate v1 release.

**Deliverables**

- **Skill package source** at `assets/forgemark-skill/`:
  - `SKILL.md` (uppercase, root) — single-file format spec extracted from the proposal's Storage Format and Format Spec for AI Authors sections, with YAML frontmatter (`name: forgemark`, `description: …`). Target < 4000 tokens. Section names rather than line numbers because the proposal evolves.
  - `examples/` — three sample annotated `.md` files of varying complexity (drawn from `tests/ai/fixtures/`).
  - `AGENTS.md` (root) — a thin pointer ("This bundle is a Forgemark skill. See `SKILL.md`.") for tools that read AGENTS.md but not SKILL.md.
  - `README.md` (root) — short instruction for human readers explaining what the package is and how to use it with Claude Code or Codex CLI.
  - Total target size: 30–60 KB.
- **Build pipeline** zips `assets/forgemark-skill/` into **two byte-identical artifacts that differ only by filename**, since Claude and Codex expect different extensions:
  - `assets/forgemark-skill.skill` — for Claude (which expects the `.skill` extension on what is otherwise a standard zip).
  - `assets/forgemark-skill.zip` — for Codex CLI and other tools that expect a `.zip` extension.
  - Both files are produced from a single zip operation; the second is created by copying or symlinking the first with the `.zip` extension. CI verifies they are byte-identical.
- **Distribution from the app:** Settings → AI Participation exposes **two download buttons**:
  - **Download for Claude (`.skill`)** — writes `forgemark-skill.skill` to `~/Downloads/` via `Tauri dialog.save`.
  - **Download for Codex (`.zip`)** — writes `forgemark-skill.zip` to `~/Downloads/`.
  - A short helper line beneath the buttons reads: "Both files contain identical content; the extension is what your AI tool expects."
- **AI test catalogue rounded out:** every test category (READ, WRITE-comment, WRITE-reply, WRITE-suggestion, WRITE-statechange, RECOVERY, ESCAPES) has enough cases to cover its concerns. Tests defined incrementally in earlier phases consolidate here. Format: a `tests/ai/cases/<category>.md` markdown catalogue (sub-agent-readable) plus a parallel `tests/ai/cases/<category>.test.ts` for the optional local SDK harness.
- **`npm run verify-ai-output` script:** local-only structural-assertion runner that ingests a captured AI output (or a path to a file the AI wrote) and runs the same assertions the harness uses. No network calls.

**Tests (skill package + end-to-end AI)**

- _Lint:_ `assets/forgemark-skill/` passes a size budget check (fails CI if total > 60 KB).
- _Build:_ `forgemark-skill.skill` and `forgemark-skill.zip` are produced from a single zip operation and are byte-identical (CI asserts `sha256(.skill) === sha256(.zip)`).
- _Integration (Claude download):_ clicking **Download for Claude** writes a valid `.skill` file (a zip with `.skill` extension) to the chosen path.
- _Integration (Codex download):_ clicking **Download for Codex** writes a valid `.zip` file to the chosen path.
- _Integration (extraction):_ extracting either artifact (Claude's via Claude's tooling, Codex's via standard `unzip`) yields a directory with `SKILL.md` at root, `examples/`, `AGENTS.md`, `README.md`.
- _AI-end-to-end:_ load the bundled SKILL.md as system prompt for an AI test; verify all category tests pass against the production sample file.
- _Manual end-to-end (Claude):_ download the `.skill`, install via Claude Code's skill mechanism, open the production sample file, ask Claude to perform every prompt from the test categories. Eyeball.
- _Manual end-to-end (Codex):_ download the `.zip`, extract per Codex's skill installation procedure (`.agents/skills/forgemark/` for repo-local, `~/.agents/skills/forgemark/` for user-global), open the production sample file in a Codex workspace, ask Codex to perform every prompt. Eyeball.

**Tests (AI-agent — gap-filling)**

- _AI-ESCAPES-01:_ Body containing `-->` literal — agent adds a comment that mentions the literal sequence. Verify escape was applied.
- _AI-ESCAPES-02:_ Body containing `<!--` literal — same.
- _AI-FORMAT-FIDELITY-01:_ Give an agent a complex fixture (mixed states), ask it to "do nothing — just return the file unchanged." Verify byte-equivalent output. (Tests that an agent can recognize a passthrough request and not re-render.)

**Acceptance**

- Every AI test category has full coverage in the local catalogue + harness.
- The bundled skill works end-to-end with both Claude and Codex (verified manually).
- Skill package is < 60 KB.

---

### Phase 13 — Release prep

**Goal:** ship-ready artifacts.

**Deliverables**

- Application icon (`.icns` for macOS, `.ico` for Windows) generated from the bracketed-pilcrow glyph at icon-stack sizes.
- Code signing (macOS Developer ID), notarization, hardened-runtime entitlements.
- Auto-update infrastructure (deferred to v1.1 if scope-tight).
- Changelog, release notes, public-facing README.
- Cross-platform validation pass on Windows.

**Tests (E2E + manual + performance)**

- _E2E:_ signed build launches without Gatekeeper prompts on a fresh macOS user account.
- _Smoke:_ a notarized build runs on a fresh macOS without development tools installed.
- _Performance smoke (end-to-end):_ open a 30,000-word annotated file with 50 existing comments. Add 5 new comments via the composer. Save. Reopen. Total elapsed under 10 seconds on a base M1 / equivalent Windows machine; UI feels responsive (no perceptible jank, no save-spinner blocking interaction).
- _Public README check:_ the public-facing README has install instructions, a screenshot, the license, a link to the proposal, and a link to the skill download.
- _Manual:_ full-app run-through against the storyboard's six flows.
- _Cross-platform:_ full-app run-through on Windows; visual snapshots compared against macOS baseline (acceptable diffs documented).

**Acceptance**

- A signed, notarized `.dmg` opens, runs, and survives the smoke test.
- All six storyboard flows execute as the design intends on both platforms.

---

## 4. Risk register

| Risk                                               | Likelihood | Mitigation                                                                                                           |
| -------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Anchor drift cases the strategy misses             | Medium     | Extensive fuzzy-match unit tests; floating-note as graceful fallback                                                 |
| HTML-comment stripping in unanticipated platforms  | Low        | Document as a known fragility; "clean export" is the user-driven version                                             |
| ProseMirror ↔ markdown round-trip introduces drift | Medium     | Round-trip parity test gates Phase 4; serializer treats body as a byte sequence between markers, never re-prettifies |
| Tauri webview quirks on Windows                    | Medium     | Platform matrix in CI from Phase 0; Windows-specific visual snapshots from Phase 1                                   |
| Performance on large files / many comments         | Low        | Sidebar virtualization above 50 cards; stress test in Phase 6                                                        |
| AI-agent test variance                             | Medium     | Structural assertions only; one transport retry; no logic retry; investigate failures rather than re-running         |
| Skill package size grows beyond 60 KB              | Low        | CI lint check fails the build if `assets/forgemark-skill/` exceeds budget                                            |
| `floating` field forgotten in proposal updates     | Low        | Pre-flight item in Phase 0; CI doc-link check verifies skill content references match proposal                       |

---

## 5. Deferred to v1.1+

- Multi-document switcher / project concept (single-doc only in v1).
- Multi-author concurrent annotation merging.
- Body-edit diff view when AI edits prose alongside comments.
- In-app undo for terminal actions (Accept, Reject, Discard).
- Deletion-time confirmation when about to delete a passage carrying comments.
- Auto-update for the app binary.
- Localization beyond Latin scripts.
- Mobile / web variants.
- A read-only diff drawer for save-conflict inspection (the v1 modal points users to manual external comparison).

`// TODO(forgemark-v1.1)` markers in code call out the hooks where each feature would land.

---

## 6. Suggested cadence

A two-engineer team could realistically ship Phases 0–3 in two weeks, Phases 4–7 in three weeks, Phases 8–11 in three weeks, and Phases 12–13 in two weeks. Total: ~10 weeks. The numbers are speculative; they assume the design is locked (it is, post v1.1) and the proposal is stable (after the Phase 0 `floating` update).

The hard gate is **Phase 3's round-trip parity** — block all UI work behind it. The other phases can flex; this one cannot.
