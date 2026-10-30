# The Forgemark file format

A Forgemark file is an ordinary Markdown or HTML document with a review inside it. The review is two additions, both HTML comments, so every Markdown renderer and every browser shows the document as if they weren't there:

1. **Markers**: a pair, `<!-- fmc:N -->` and `<!-- /fmc:N -->`, around each passage a comment is on.
2. **The comments block**: one HTML comment at the end of the file, holding every comment as a YAML record.

Everything else in the file is the author's, and is kept byte for byte. A file with no comments is a plain document: no markers, no block.

This page is the specification, for anyone writing a tool that reads or writes these files. Forgemark's own implementation is `src/format/` (`parser.ts`, `serializer.ts`, `yaml-emit.ts`); the command-line tool in `cli/` is built from it, and is the safest way to change a file from another program. The agent skill ([`assets/forgemark-skill/SKILL.md`](../assets/forgemark-skill/SKILL.md)) carries a shorter version of this page for AI agents.

## An example

```markdown
Across <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 -->,
the strongest predictor of week-two retention was completing a real piece of work.

<!-- forgemark-comments
- id: 1
  anchor_text: "fourteen interviews with new enterprise customers"
  context_before: "Across"
  context_after: ", the strongest predictor of week-two retention"
  author: Steven
  timestamp: 2026-05-07T14:32:00Z
  resolved: false
  body: |
    Worth noting the sample composition.
  replies:
    - author: Claude
      timestamp: 2026-05-07T15:02:00Z
      body: |
        Added a sentence on it.
-->
```

## Markers

`<!-- fmc:N -->` opens and `<!-- /fmc:N -->` closes the passage of comment `N`, where `N` is the comment's `id`. Readers accept any whitespace inside the comment (`<!--fmc:1-->`); writers emit exactly one space each side.

- Every comment that isn't floating has exactly one pair, and every pair has a record.
- The open comes before the close, and the pair wraps one contiguous passage.
- Pairs never overlap or nest. The one exception is HTML passage anchors (`anchor_kind: passage`) on the same element, which sit one inside another around it, since one figure may show a different chart per tab and each can carry its own comment.
- A pair may enclose inline formatting (`*em*`, `[links](…)`, `` `code` ``), but never sits inside it where that would change what it means: never inside a code span, a fenced or indented code block, a math block, or front matter, where it would be shown as text or change the value. To anchor a whole code block, the pair goes on its own lines around the fence.
- In HTML, a marker never sits inside `<script>`, `<style>`, `<textarea>`, `<title>`, or a tag or attribute value. A pair may cross tags.

What a marker means where it can't go (inside a code span, say) is that it isn't a marker: it's text, and the comment it was meant for has no anchor.

## The comments block

```
<!-- forgemark-comments
<YAML list of comment records>
-->
```

- `<!-- forgemark-comments` is alone on its line, at the start of the line.
- `-->` is alone on the last non-blank line of the file. Only whitespace may follow it.
- Between them is a YAML sequence of records, one per comment, in any order. Writers keep them in id order.
- There is one block per file. If a file has two, readers take the last one, and the comments in the others are invisible, so a writer must never add a second block.
- A writer separates the block from the body with one blank line, and removes the block when the last comment is deleted.

### Escapes

The block is a single HTML comment, so its text can't contain `-->` or `<!--`. In every text field, writers replace them, and readers put them back:

| In the text | In the block |
| ----------- | ------------ |
| `-->`       | `--\>`       |
| `<!--`      | `<!\--`      |

### YAML

The records are YAML 1.2. Forgemark writes them the same way every time, so a file's diff shows only what changed:

- two-space indentation, and fields in the order of the table below;
- a one-line string bare when YAML can't read it as anything else, and double-quoted when it could (`"true"`, `"42"`, `"a: b"`);
- a string of several lines as a literal block (`|`), which keeps its final newline.

Readers accept any valid YAML that gives the same values.

## Records

| Field                             | Required            | Value                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | yes                 | A positive integer, unique in the file. Never reused, and never renumbered: ids are sparse after deletions.                                                                                                                                                                                                                      |
| `floating`                        | no                  | `true` for a note with no passage: no markers, and no `anchor_text` needed.                                                                                                                                                                                                                                                      |
| `anchor_frontmatter`              | no                  | With `floating: true`, a comment on a Markdown file's front matter. `anchor_text` is the passage of the front matter it's on. Markers can't go in front matter, which other programs read.                                                                                                                                       |
| `anchor_text`                     | unless floating     | The passage as a reader sees it: Markdown syntax and HTML tags removed, entities and backslash escapes decoded, whitespace collapsed to single spaces. For an element anchor, its caption. It's what a sidebar shows, and what a reader searches for when the markers are lost. The markers, not this field, attach the comment. |
| `anchor_kind`                     | no                  | HTML only. Absent: the markers wrap a run of text. `element`: they wrap a whole figure, chart or table. `passage`: they wrap an element the page's script fills when it loads, and `anchor_text` is the passage inside it, which has no place of its own in the source.                                                          |
| `anchor_selector`                 | no                  | HTML only. `#id` of the anchored element, so the comment can be put back exactly when the report is regenerated and the id survives.                                                                                                                                                                                             |
| `anchor_scope`                    | no                  | HTML only, for a run of text. `#id` of the innermost element with an id that holds it, so a sentence repeated in several sections is put back in the right one.                                                                                                                                                                  |
| `context_before`, `context_after` | recommended         | Up to 80 characters of the text before and after the passage, as a reader sees it, cut at whole words. Hints for putting a lost comment back in the right place. They aren't updated when the text around them changes.                                                                                                          |
| `author`                          | yes                 | The name the commenter chose. Free text.                                                                                                                                                                                                                                                                                         |
| `timestamp`                       | yes                 | When the comment was made, ISO 8601 in UTC: `2026-05-07T14:32:00Z`.                                                                                                                                                                                                                                                              |
| `edited_at`                       | no                  | When the body was last edited, in the same form.                                                                                                                                                                                                                                                                                 |
| `resolved`                        | yes                 | `true` or `false`. A resolved comment stays in the file.                                                                                                                                                                                                                                                                         |
| `body`                            | unless a suggestion | The comment, as Markdown.                                                                                                                                                                                                                                                                                                        |
| `suggested_edit`                  | no                  | `{from, to}`. `from` is exactly the source between the markers; `to` replaces it.                                                                                                                                                                                                                                                |
| `replies`                         | no                  | A list of `{author, timestamp, edited_at?, body}`, oldest first. One `replies` key per record.                                                                                                                                                                                                                                   |

A reader keeps any field it doesn't know, in the record or in a reply, and a writer puts it back unchanged, after the known fields. That's what lets an older version open a file a newer one wrote without losing anything.

## What the operations do

- **Comment**: add a marker pair and a record with the next unused id.
- **Reply**: append to the record's `replies`.
- **Resolve** and **reopen**: set `resolved`. Nothing else changes.
- **Delete**: remove the record and its markers.
- **Accept a suggestion**: replace the source between the markers with `to`, then remove the markers and the record.
- **Reject a suggestion**: remove the markers and the record, leaving the text as it was.
- **Float**: remove the markers, set `floating: true`, and drop the anchor fields (`anchor_text`, `anchor_kind`, `anchor_selector`, `anchor_scope` and the context). The body and replies stay.

## Reading a damaged file

A file edited by hand, or by a tool that doesn't know the format, can lose a marker, duplicate one, or move one inside a code span. A reader shouldn't discard the review over it. Forgemark's reader:

- keeps a record whose markers are gone, as an orphan to be put back (by searching for `anchor_text` where `context_before` and `context_after` still match) or floated;
- drops markers that have no record, are unmatched, or are duplicated;
- reads only the last block if there are several, and says so.

If the YAML itself can't be read, it shows the document with no comments, and refuses to save over the block.

## Writing a file safely

- Change only the markers you're adding or removing, and the block. Leave every other byte of the body as it was, line endings included.
- Read back what you're about to write, and don't write it unless it parses to the records you meant.
- Replace the file atomically: write a temporary file beside it and rename it over.

The command-line tool does all three; from another program, running it (`forgemark comment`, `reply`, `resolve`, `float`, `reattach`, `lint`) is simpler than reimplementing this page.

## Compatibility

The format has no version number in the file. Instead:

- A new field is always optional, and a reader that doesn't know it keeps it. A new Forgemark version may add fields; a file it writes stays readable by older versions, which keep what they don't understand.
- A change an older reader would get wrong (a new meaning for an existing field, or a marker it wouldn't recognise) is a breaking change. It would come with a new major version of Forgemark, and be recorded in the changelog.

`forgemark lint` reports anything in a file that Forgemark would refuse, or that a reviewer would want to know about.
