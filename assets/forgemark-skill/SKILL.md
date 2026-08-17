---
name: forgemark
description: Read or write Forgemark-format documents — Markdown files or generated HTML reports carrying inline comments, threaded replies, suggested edits, and floating notes stored as a YAML block at the end of the file. Use this skill whenever the user asks you to "add a comment", "leave a review note", "address comments", "respond to feedback", "suggest an edit", "reply to a comment", "resolve this", or otherwise work with reviewer markup inside a Markdown file or an HTML report. Also trigger when the user mentions "Forgemark", "review notes", "the comments in this doc", or similar; or when an opened .md or .html file contains paired HTML-comment anchor markers in the form fmc colon N together with a trailing forgemark-comments YAML block. Also read this before regenerating an HTML report that has been reviewed, so the review survives. When in doubt and the file has reviewer-style annotations, prefer this skill over reading the format from scratch.
---

# Forgemark format

You are reading a file produced or consumed by **Forgemark**, a collaborative review tool. Forgemark files are plain Markdown — or a plain HTML report — with two additions: paired inline HTML-comment markers around commented passages, and a single trailing HTML comment containing a YAML block of comment records.

The two additions are HTML comments, so the format is **identical in Markdown and in HTML** and needs no translation between them. What differs is only where a marker may legally sit; see "HTML reports" below.

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

   **Whole code block anchors** are a special case: markers cannot live _inside_ a fenced code block (the parser treats fence contents as code, not anchors). To anchor a comment to an entire code block, put the marker pair on **its own lines, immediately around the fence** (open marker on the line before the opening fence, close marker on the line after the closing fence):

       <!-- fmc:N -->
       ```python
       print("hi")
       ```
       <!-- /fmc:N -->

   Here `anchor_text` is the full text inside the fence (e.g. `print("hi")`). This is the only supported way to comment on a code block; never place markers between the backticks. Comments may also anchor a span that merely _includes_ inline code (`` `like this` ``) — the markers just sit outside the backticks as usual.

2. **Trailing comments block** — a single HTML comment at the end of the file. Opens with `<!-- forgemark-comments` on its own line, closes with `-->` on its own line. Contains a YAML list of comment records.

There is **at most one** trailing comments block per file. If a file has no comments, the block is absent — clean files stay clean.

## HTML reports

Everything above applies unchanged to an `.html` file. The markers are HTML comments, so they are already valid HTML and invisible in a browser; the trailing block goes **after `</html>`**, where browsers ignore it.

```html
<p>Minimising over the rest is <b><!-- fmc:1 -->variable projection<!-- /fmc:1 --></b>.</p>
</body></html>

<!-- forgemark-comments
- id: 1
  anchor_text: "variable projection"
  author: Claude
  timestamp: 2026-08-16T09:14:00Z
  resolved: false
  body: |
    Worth a one-line gloss for readers who don't know the method.
-->
```

Four HTML-specific rules:

1. **Never put a marker inside `<script>`, `<style>`, `<textarea>`, `<title>`, or an attribute value.** Text in those places is not parsed as a comment, so a marker there is invented markup with no anchor — the same class of error as splitting a marker pair.

2. **An anchor may cross tags.** `<!-- fmc:1 -->ISF</code> from this record<!-- /fmc:1 -->` is valid and renders normally, because the markers are invisible. Keep it to one pair, as in Markdown.

3. **To comment on a figure, chart, or table, wrap the whole element** and set `anchor_kind: element`. This is the HTML counterpart of a whole-code-block anchor, and it is the only way to comment on something with no text to select:

   ```html
   <!-- fmc:2 --><figure id="fig-3"><figcaption>Figure 3. Recovery</figcaption><svg>…</svg></figure><!-- /fmc:2 -->
   ```

   Use the element's caption as `anchor_text`, and record `anchor_selector: "#fig-3"` when the element has an id.

4. **A suggestion must replace text, not markup.** Only add `suggested_edit` when the source between the two markers contains no `<`. Accepting a suggestion replaces everything between the markers, so a suggestion spanning tags would mangle the document.

### Regenerating a report that has been reviewed

This is the case that matters most, and the one that silently destroys work if you get it wrong. HTML reports are usually **rebuilt** rather than edited: you rerun the generator and write a whole new file. That drops every marker, and the comments — which survive in the trailing block — become orphans the reviewer has to reattach by hand.

When you rewrite a reviewed report:

- **Carry the trailing `<!-- forgemark-comments -->` block over verbatim.** Losing it discards the entire review.
- **Re-insert the marker pairs** around the same passages, wherever the passage still exists.
- **Give sections, figures, and tables stable `id` attributes, and keep them stable across regenerations.** A comment that recorded `anchor_selector: "#fig-3"` reattaches exactly when that id survives, even if the caption was renumbered. Without it, recovery falls back to matching prose and becomes a guess.
- If a commented passage is genuinely gone, leave its record in place. Forgemark will surface it as an orphan so the reviewer can decide, which is the right outcome — silently dropping the comment is not.

## Comment record schema

Each YAML entry under the trailing block is a comment object:

| Field            | Type    | Required                                              | Notes                                                                                                            |
| ---------------- | ------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`             | integer | yes                                                   | Sequential within the file, starting at 1. Never reused.                                                         |
| `anchor_text`    | string  | yes (unless `floating: true`)                         | The exact text wrapped between the inline markers. For an element anchor, the element's caption.                 |
| `anchor_kind`    | string  | optional                                              | Only value: `element`, meaning the markers wrap a whole block (figure, chart, table). Omit for text anchors.     |
| `anchor_selector`| string  | optional                                              | CSS selector identifying an anchored element, e.g. `#fig-3`. Used to reattach exactly after a report is rebuilt. |
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

3. **Wrap the anchored passage with paired markers** (skip for floating notes — see rule 11). Insert `<!-- fmc:N -->` and `<!-- /fmc:N -->` around the exact text being anchored. Never place markers _inside_ a fenced code block or between inline-code backticks — those regions are not parsed as anchors. To comment on a code block, anchor the **whole block** by putting the marker pair on its own lines around the fence (see "Whole code block anchors" above).

   Emit **exactly one** open and one close marker per id, and keep the pair spanning a single contiguous passage — do not split it into multiple pairs around inline formatting (`*emphasis*`, `[links](…)`). The markers are invisible HTML comments, so a single pair may safely enclose inline markdown syntax.

4. **Anchors must not overlap or nest.** A new anchor's span may not partially overlap, coincide with, or sit inside another comment's anchored span — the format cannot represent overlapping anchors, and doing so corrupts the file. If you want to comment on text that's already anchored, add a **reply** to that comment instead (or anchor a different, non-overlapping span).

5. **Use ISO 8601 in UTC for timestamps.** Format: `2026-05-07T14:32:00Z`.

6. **Escape HTML-comment-forbidden sequences in user-content fields** (`body`, `anchor_text`, `context_before`, `context_after`):
   - Replace `-->` with `--\>`.
   - Replace `<!--` with `<!\--`.
     These are reversed automatically when the file is loaded back by the application.

7. **Use any name for `author`.** Self-identification is by convention only. "Claude" is fine; so is your specific model identity if you prefer.

8. **Resolved threads stay in the file.** Setting `resolved: true` does NOT remove the comment — it just marks it. Don't delete a comment unless the user asked you to.

9. **Suggested-edit Accept and Reject are terminal.** Both remove the comment object AND its inline marker pair from the file. Don't leave a "resolved suggestion" behind.

10. **Floating notes have no inline markers.** When a comment has `floating: true`, do not insert `<!-- fmc:N -->` markers in the body. The comment lives only in the YAML block, with `anchor_text` optional. You can also _author_ a floating note yourself when you want to leave a general comment that doesn't pin to a single passage — set `floating: true` and skip the markers.

11. **Don't reformat the rest of the file.** Round-tripping should change only what the user asked for. Leave whitespace, formatting, and unmodified comment records alone.

## What to do when asked

- **"Address a comment"** — read what the comment says, edit the document body to fix the issue, then add a reply explaining what you changed. Don't mark the comment resolved unless explicitly asked.
- **"Add a comment"** — pick the right passage, wrap it with markers using the next id, append a YAML record with your `author`, `timestamp`, `body`. In an HTML report you may instead wrap a whole figure or table; set `anchor_kind: element` and `anchor_selector` if it has an id.
- **"Suggest an edit"** — same as adding a comment, but include `suggested_edit: { from: "...", to: "..." }`. The `body` field is optional for suggestions.
- **"Resolve a comment"** — set `resolved: true` on the YAML record. Do not remove the record.
- **"Delete a comment"** — remove the YAML record AND its inline marker pair from the file.
- **"Convert this orphan to a floating note"** — set `floating: true`, remove the inline markers, optionally clear `anchor_text` / `context_before` / `context_after`. The record stays in the YAML block.

When you return a modified file, return the **complete file** (not a diff or excerpt). The user's tooling parses the whole result.

## Validation invariants

The application's parser will reject files that violate any of these:

- Comment ids are unique within the file.
- Every YAML record with `floating !== true` has matching `<!-- fmc:N --> ... <!-- /fmc:N -->` markers in the body.
- Each id appears as **exactly one** open/close marker pair — never duplicated, split, or nested with another id's pair. Anchors must not overlap.
- Every marker pair in the body has a matching YAML record.
- `anchor_text` is present for non-floating comments; absent or empty for floating notes is fine.
- `anchor_kind`, if present, is exactly `element`.
- In an HTML file, no marker sits inside `<script>`, `<style>`, `<textarea>`, `<title>`, or an attribute value.
- `body` is non-empty for plain comments; may be empty for comments that have a `suggested_edit`.

If your output trips one of these, the app surfaces a parse error. (Recent versions fail soft — they recover the comments they can and flag damaged anchors for reattachment rather than hiding everything — but you should still emit a valid file.) Re-check the structure before returning the file.
