---
name: forgemark
description: Forgemark file format for collaborative review of markdown documents. Read and write inline comments, threaded replies, suggested edits, and floating notes — all stored inside the .md file itself.
---

# Forgemark format

You are reading a markdown file produced or consumed by **Forgemark**, a collaborative review tool. Forgemark files are plain markdown with two additions: paired inline HTML-comment markers around commented passages, and a single trailing HTML comment containing a YAML block of comment records.

Both humans and AI agents (you) are first-class participants. Use this spec to read existing comments and write new ones correctly.

## File structure

```
... ordinary markdown content ...

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
-->
```

Two structural elements:

1. **Inline anchor markers** — paired HTML comments wrapping a commented passage in the body:
   `<!-- fmc:N -->anchored text<!-- /fmc:N -->`
   where `N` is the integer comment id. Markers are HTML comments, so they are invisible in any rendered markdown view.

2. **Trailing comments block** — a single HTML comment at the end of the file. Opens with `<!-- forgemark-comments` on its own line, closes with `-->` on its own line. Contains a YAML list of comment records.

There is **at most one** trailing comments block per file. If a file has no comments, the block is absent — clean files stay clean.

## Comment record schema

Each YAML entry under the trailing block is a comment object:

| Field            | Type    | Required                                              | Notes                                                                                                            |
| ---------------- | ------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`             | integer | yes                                                   | Sequential within the file, starting at 1. Never reused.                                                         |
| `anchor_text`    | string  | yes (unless `floating: true`)                         | The exact text wrapped between the inline markers.                                                               |
| `context_before` | string  | recommended                                           | ~1 sentence before the anchor — used for orphan recovery.                                                        |
| `context_after`  | string  | recommended                                           | ~1 sentence after the anchor.                                                                                    |
| `author`         | string  | yes                                                   | Free-form name. Humans set this in app preferences; AI agents pick their own (e.g., `Claude`, `ChatGPT`).        |
| `timestamp`      | string  | yes                                                   | ISO 8601 in UTC, e.g. `2026-05-07T14:32:00Z`.                                                                    |
| `edited_at`      | string  | optional                                              | ISO 8601 UTC, set when the original author edits the body.                                                       |
| `resolved`       | boolean | yes (default `false`)                                 |                                                                                                                  |
| `body`           | string  | required for plain comments; optional for suggestions | Use a YAML literal block (`\|`) for multi-line text.                                                             |
| `replies`        | list    | optional                                              | Each reply has `author`, `timestamp`, `body`, optional `edited_at`. Stays in chronological order.                |
| `suggested_edit` | object  | optional                                              | If present, the comment is a suggestion. Keys: `from` (text to replace) and `to` (proposed replacement).         |
| `floating`       | boolean | optional (default `false`)                            | When true, the comment has no inline marker pair and `anchor_text` may be omitted. Lives only in the YAML block. |

Unknown fields in a comment record must be **preserved** on round-trip — future versions of the format may add fields, and stripping them silently corrupts forward compatibility.

## Rules for writing

When you add or modify a comment:

1. **Locate or create the comments block.** It opens with `<!-- forgemark-comments` on its own line and closes with `-->` on its own line. If the file has no block yet and you are adding the first comment, create the block at the very end of the file with one blank line before it.

2. **Pick the next integer id.** New comments get `max(existing_ids) + 1`, or `1` if there are no comments yet. IDs are unique within a file and never reused.

3. **Wrap the anchored passage with paired markers** (skip for floating notes — see rule 9). Insert `<!-- fmc:N -->` and `<!-- /fmc:N -->` around the exact text being anchored. Do not split markers inside fenced code blocks or inline code spans — those regions are not parsed as anchors.

4. **Use ISO 8601 in UTC for timestamps.** Format: `2026-05-07T14:32:00Z`.

5. **Escape HTML-comment-forbidden sequences in user-content fields** (`body`, `anchor_text`, `context_before`, `context_after`):
   - Replace `-->` with `--\>`.
   - Replace `<!--` with `<!\--`.
     These are reversed automatically when the file is loaded back by the application.

6. **Use any name for `author`.** Self-identification is by convention only. "Claude" is fine; so is your specific model identity if you prefer.

7. **Resolved threads stay in the file.** Setting `resolved: true` does NOT remove the comment — it just marks it. Don't delete a comment unless the user asked you to.

8. **Suggested-edit Accept and Reject are terminal.** Both remove the comment object AND its inline marker pair from the file. Don't leave a "resolved suggestion" behind.

9. **Floating notes have no inline markers.** When a comment has `floating: true`, do not insert `<!-- fmc:N -->` markers in the body. The comment lives only in the YAML block, with `anchor_text` optional. You can also _author_ a floating note yourself when you want to leave a general comment that doesn't pin to a single passage — set `floating: true` and skip the markers.

10. **Don't reformat the rest of the file.** Round-tripping should change only what the user asked for. Leave whitespace, formatting, and unmodified comment records alone.

## What to do when asked

- **"Address a comment"** — read what the comment says, edit the document body to fix the issue, then add a reply explaining what you changed. Don't mark the comment resolved unless explicitly asked.
- **"Add a comment"** — pick the right passage, wrap it with markers using the next id, append a YAML record with your `author`, `timestamp`, `body`.
- **"Suggest an edit"** — same as adding a comment, but include `suggested_edit: { from: "...", to: "..." }`. The `body` field is optional for suggestions.
- **"Resolve a comment"** — set `resolved: true` on the YAML record. Do not remove the record.
- **"Delete a comment"** — remove the YAML record AND its inline marker pair from the file.
- **"Convert this orphan to a floating note"** — set `floating: true`, remove the inline markers, optionally clear `anchor_text` / `context_before` / `context_after`. The record stays in the YAML block.

When you return a modified file, return the **complete file** (not a diff or excerpt). The user's tooling parses the whole result.

## Validation invariants

The application's parser will reject files that violate any of these:

- Comment ids are unique within the file.
- Every YAML record with `floating !== true` has matching `<!-- fmc:N --> ... <!-- /fmc:N -->` markers in the body.
- Every marker pair in the body has a matching YAML record.
- `anchor_text` is present for non-floating comments; absent or empty for floating notes is fine.
- `body` is non-empty for plain comments; may be empty for comments that have a `suggested_edit`.

If your output trips one of these, the user's app will surface a parse error. Re-check the structure before returning the file.
