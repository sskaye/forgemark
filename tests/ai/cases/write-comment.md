# AI-WRITE-comment test category

Verifies AI agents can write a Forgemark file: add a new comment with the correct id, marker placement, schema fields, and escape rules.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — `assets/forgemark-skill/SKILL.md` is loaded as system context
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the modified file must satisfy
- **Last run** — captured output from the most recent sub-agent invocation, with notes on whether expectations were met

---

## AI-WRITE-comment-01 — single new comment

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Add ONE new comment on the second paragraph (the one starting "Teams that scheduled..."). Pick whatever short anchor passage you like inside that paragraph. Author the comment as "Claude". Body: anything reasonable about the second paragraph.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly through `parseForgemarkFile`.
- One new comment exists; total count = `original + 1`.
- New comment id = `max(existing) + 1` (the original fixture has ids 1, 2 → new is 3).
- New comment author = `"Claude"`.
- Timestamp matches `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`.
- Body is non-empty.
- Inline marker pair is present in the body and matches the comment's id.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Agent placed `<!-- fmc:3 -->...<!-- /fmc:3 -->` around "self-serve teams" in the second paragraph and added a well-formed YAML record with `id: 3`, `author: Claude`, ISO 8601 timestamp, and a 246-byte body. File round-trips through the parser without errors.

---

## AI-WRITE-comment-02 — three new comments at once

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Add THREE new comments. Each on a different short anchor passage. Author them as "Claude". Bodies can be anything reasonable.
>
> The new comments must have sequential ids starting from `max(existing_ids) + 1` and not collide with existing ids.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Total comments = original + 3 (= 5 total).
- New ids are unique and contiguous starting at `max(existing) + 1` (= 3, 4, 5).
- Every new comment has matching marker pair + valid ISO 8601 timestamp.
- Round-trip parity holds: parse → serialize → parse yields the same Comment array.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Agent emitted 5 comments with ids `[1, 2, 3, 4, 5]`, three new markers placed across both paragraphs, all timestamps valid, all marker pairs present.

---

## AI-WRITE-comment-03 — body containing `-->`

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Add ONE new comment. The COMMENT BODY must contain the literal three-character sequence `-->` somewhere. Apply the escape rule from the spec so the file remains parseable.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly (no premature termination of the trailing HTML comment).
- The new comment's `body`, on parse, contains the literal string `-->` (i.e. the escape was applied on serialize and reversed on load).

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Agent wrote `--\>` in the YAML source body; the parser unescaped it to `-->` on load. The trailing comment block remained valid.

---

## How to re-run

From a Claude Code session at the repo root, spawn an Agent with one of the prompts above + the indicated fixture + the skill content from `assets/forgemark-skill/SKILL.md`. Pass each prompt verbatim. After the agent returns, save the fenced output to `/tmp/forgemark-write-N.md` and run a small parse-and-assert script (the one used during Phase 5 verification is in shell history; equivalents live alongside the SDK harness in `tests/ai/cases/write-comment.test.ts` once Phase 12 wires it).
