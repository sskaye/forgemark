---
name: forgemark
description: Read, add, and answer review comments in Forgemark-format documents: Markdown files or generated HTML reports carrying inline comments, threaded replies, suggested edits, and floating notes, stored as paired HTML-comment markers plus a trailing forgemark-comments YAML block. Ships a command-line tool (scripts/forgemark.mjs) that does every read and write safely; use it instead of editing the comments block by hand. Use this skill whenever the user asks you to "add a comment", "leave a review note", "address comments", "respond to feedback", "suggest an edit", "reply to a comment", "resolve this", or otherwise work with reviewer markup in a Markdown file or an HTML report; when the user mentions "Forgemark", "review notes", or "the comments in this doc"; when an opened .md or .html file contains paired fmc:N HTML-comment markers with a trailing forgemark-comments block; and before regenerating an HTML report that has been reviewed, so the review survives.
---

# Forgemark

Forgemark is a review tool. A reviewed document is an ordinary `.md` or `.html` file with two additions: paired markers `<!-- fmc:N -->…<!-- /fmc:N -->` around commented passages, and one trailing `<!-- forgemark-comments … -->` block holding the comment records as YAML. Humans read and write it in the Forgemark app; you read and write it with the tool below.

**Use the tool for every read and write of comments. Do not edit the comments block or place markers by hand.** Hand-written YAML and hand-placed markers are where reviews get lost: one bad record hides every comment in the file, and the file looks fine until the reviewer opens it. The tool uses the app's own parser and serializer, checks that every write reads back, and writes atomically, so what it produces is exactly what the app would have written. If it cannot run, stop and tell the user rather than working around it.

## The tool

`scripts/forgemark.mjs`, next to this file. It is one self-contained file with no dependencies; the only requirement is a `node` binary (18 or newer), which the harness running you almost certainly has. There is nothing to install.

```bash
node <skill directory>/scripts/forgemark.mjs --help
```

`<skill directory>` is the directory containing this SKILL.md. **In every command below, `forgemark` is shorthand for `node <skill directory>/scripts/forgemark.mjs`.** Substitute the full command when you run one.

| Command | What it does |
| --- | --- |
| `forgemark list <file> [--unresolved] [--orphaned] [--json]` | Every comment, one per entry: id, kind, open/resolved, attached/orphaned/floating, author, anchor, first line, reply count. |
| `forgemark show <file> <id> [--json]` | One thread in full: anchor and its context, the body, every reply in order, any suggested edit. |
| `forgemark comment <file> --author NAME --anchor "passage" --body "…"` | Comment on a passage. Quote it as a reader sees it; line breaks and inline formatting are ignored when matching. |
| `forgemark comment <file> --author NAME --anchor "passage" --suggest "replacement" [--body "…"]` | Suggest an edit: the reviewer can accept it in one click. `--body` is optional here. |
| `forgemark comment <file> --author NAME --selector "#fig-3" --body "…"` | HTML only: comment on a whole figure, chart, or table by its `id`. |
| `forgemark comment <file> --author NAME --floating --body "…"` | A note on the document as a whole, with no anchor. |
| `forgemark reply <file> <id> --author NAME --body "…"` | Reply to a thread. Replies are append-only; there is no command to edit or remove one, so add a new reply rather than trying to change an old one. |
| `forgemark resolve <file> <id>` / `unresolve` | Mark a thread resolved, or reopen it. |
| `forgemark float <file> <id>` | Turn a comment whose passage is gone into a floating note. |
| `forgemark reattach <file> <id> --anchor "passage"` | Give an orphaned or floating comment a new anchor. |
| `forgemark delete <file> <id>` | Remove a comment and its markers. Only when asked. |
| `forgemark lint <file>… [--strict]` | Check a file the way the app will read it. Run it before handing a file back. |

Options that apply everywhere:

- `--author NAME` is required for `comment` and `reply`, or set `FORGEMARK_AUTHOR` in the environment. Use your own name ("Claude", "Codex", …).
- `--body "…"` for short text; `--body-file path` for longer text; `--body-file -` reads stdin. Any characters are fine, including colons, quotes, `-->`, and multiple lines.
- `--occurrence N` when a quoted passage appears more than once. The tool refuses an ambiguous passage and lists the places it found, so you can pick or quote more words.
- `--json` for machine-readable output from `list`, `show`, and `lint`.

Exit codes: 0 done; 1 refused (the file has problems, the passage is ambiguous, the span overlaps another comment) with the reason on stderr; 2 usage; 3 the file could not be read or written. A refused write changes nothing.

## Workflows

**Read the review.** `forgemark list <file>` first; then `forgemark show <file> <id>` for the threads you will act on. Filter with `--unresolved` when the file has many.

**Address a comment.** `show` it, edit the document's prose with your usual editing tools, then `forgemark reply <file> <id> --author NAME --body "…"` saying what you changed, then `forgemark lint <file>`. Don't `resolve` unless the user asked; the reviewer decides when a thread is done.

**Leave a comment.** `forgemark comment <file> --author NAME --anchor "…" --body "…"`. Pick the exact passage the comment is about; a shorter, distinctive phrase beats a whole paragraph. To comment on something already commented on, reply to that thread instead — anchors may not overlap, and the tool will tell you which comment is in the way. To comment on a code block, quote a line inside it; the tool anchors the whole block.

**Suggest an edit.** `forgemark comment <file> --author NAME --anchor "old words" --suggest "new words"`. Accepting replaces exactly the anchored text, so anchor precisely what should change.

**Hand the file back.** `forgemark lint <file>`. It reports what the app would refuse (errors) and what the reviewer would rather not meet (warnings: an orphaned comment, an anchor description that no longer matches). Fix errors; settle orphans with `reattach` or `float`.

## Editing prose around markers

When you edit the document body, the markers are in your way and you must leave them intact:

- **Keep every `<!-- fmc:N -->` / `<!-- /fmc:N -->` pair together and in order.** Deleting one of a pair, duplicating a pair, or nesting pairs is corruption; `lint` reports it.
- **Adding text next to an anchored passage:** put it outside the markers, unless the comment is about the new text too. The anchor then still describes exactly what the reviewer pointed at.
- **Context fields on existing comments are not updated when the prose around them changes.** That is expected; they are hints for recovering a lost anchor, and `lint` does not warn about them.
- **Rewriting an anchored passage:** keep the pair around the rewritten text, or shrink it to a short leading phrase of the new text. The description recorded for the comment will drift; `lint` warns, and that is fine — the marker pair is what attaches the comment. Or `float` the comment when the passage is truly gone.
- **Deleting an anchored passage:** delete the markers with it, then `forgemark float <file> <id>` (the comment survives as a note) or `reattach` it elsewhere.
- **Never touch the trailing `<!-- forgemark-comments` block.** Every command that changes it rewrites it correctly. If the tool cannot run (no `node`, or the file is missing), stop and tell the user; do not write the block by hand.
- **Hard-wrapped source is fine.** Anchors may span line breaks; the tool matches across them.
- **Obsidian syntax may be present** — `> [!Type]` callouts of any type, `![[image.png|alt]]` embeds, `[[note|label]]` wikilinks — and the app keeps it as written. Leave it as you find it; a marker pair may wrap the visible label of a wikilink or the alt text of an embed as it would any other inline text.

## HTML reports

Everything above applies to `.html` files unchanged; the storage format is identical. Two differences:

- Quote passages as rendered — the text a browser shows — even where the source has tags or entities inside them. Use `--selector "#id"` to comment on a figure, chart, or table that has an `id`; that is the only way to comment on something with no text.
- **Regenerating a reviewed report** drops every marker, since the generator writes a new body. Carry the trailing comments block over verbatim, keep the `id` attributes of sections, figures, and tables stable across builds (a comment made with `--selector` reattaches exactly when its id survives), then run `forgemark lint` — the orphans it lists can be settled with `reattach`, or left for the reviewer, who has a bulk-reattach flow. Never drop the block: that discards the review.

## Format reference

Read this to understand a file you are looking at. It is not a licence to write one by hand: if the tool cannot run, stop and tell the user.

```
Some prose with <!-- fmc:1 -->an anchored passage<!-- /fmc:1 --> and more prose.

<!-- forgemark-comments
- id: 1
  anchor_text: "an anchored passage"
  context_before: "Some prose with"
  context_after: "and more prose."
  author: Steven
  timestamp: 2026-05-07T14:32:00Z
  resolved: false
  body: |
    Should this be tightened?
  replies:
    - author: Claude
      timestamp: 2026-05-07T15:02:00Z
      body: |
        Tightened in the next revision.
-->
```

**Markers.** `<!-- fmc:N -->` and `<!-- /fmc:N -->`, one pair per comment, wrapping one contiguous passage. Pairs never overlap or nest, with one exception: passage anchors (below) on the same element sit one inside another around it, since one figure may show a different chart per tab and each can carry its own comment. A pair may enclose inline formatting (`*em*`, `[links](…)`, `` `code` ``) but never sits inside backticks or a fenced code block; to anchor a whole code block, the pair goes on its own lines around the fence. In HTML, a marker never sits inside `<script>`, `<style>`, `<textarea>`, `<title>`, or an attribute value; a pair may cross tags, and may wrap a whole element (`anchor_kind: element`), or wrap the element that a script fills at load when the comment is about text inside it (`anchor_kind: passage`).

**The block.** One per file, at the very end: `<!-- forgemark-comments` on its own line, a YAML list, `-->` on its own line. A file with no comments has no block. Two blocks in one file means the app reads only the last and the rest of the review is invisible.

**Records.**

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Positive integer, unique in the file, never reused. Ids are sparse after deletions — do not renumber. |
| `anchor_text` | unless `floating: true` | The passage as rendered: Markdown formatting and HTML tags stripped, whitespace collapsed. Advisory — the markers attach the comment; this is what the sidebar shows and what recovery searches for if the markers are lost. For an element anchor, the caption. |
| `anchor_kind` | optional | `element`: the markers wrap a whole figure, chart, or table. `passage`: the markers wrap an element the report's own script fills at load, and `anchor_text` is the passage inside it the comment is about — text that has no place of its own in the source. Find it in the rendered report, or in the script that produces it. |
| `anchor_selector` | optional | `#id` of an anchored element, for exact reattachment after a rebuild. |
| `context_before`, `context_after` | recommended | About a sentence either side, for recovery. |
| `author` | yes | Free-form name. |
| `timestamp` | yes | ISO 8601 UTC, `2026-05-07T14:32:00Z`. |
| `edited_at` | optional | Same shape, set when the author edits the body. |
| `resolved` | yes | Boolean. Resolved threads stay in the file. |
| `body` | plain comments | Text. Optional for a suggestion. |
| `replies` | optional | List of `{author, timestamp, body, edited_at?}` in chronological order. One `replies:` key per record — append to the list, never add a second key. |
| `suggested_edit` | optional | `{from, to}`. `from` is the exact source between the markers; accepting replaces it with `to` and removes the comment and its markers. |
| `floating` | optional | `true` means no markers and no anchor. |

Unknown fields are preserved on round-trip.

**Escapes.** Inside the block, `-->` is written `--\>` and `<!--` is written `<!\--`; the app reverses this on read. You will see these in files; the tool writes them for you.

**Accept and reject** of a suggestion are terminal: both remove the record and the markers; accept also replaces the text. **Delete** removes the record and the markers. **Resolve** only flips the flag.

