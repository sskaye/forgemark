# AI-WRITE-reply / AI-WRITE-statechange test categories

Verifies AI agents can drive the comment-card lifecycle: append a reply, mark resolved, delete (with cascade), and edit own comment.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — `assets/forgemark-skill/SKILL.md` is loaded as system context
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the modified file must satisfy
- **Last run** — captured output from the most recent sub-agent invocation, with notes on whether expectations were met

---

## AI-WRITE-reply-01 — append a reply to an existing thread

**Fixture:** `tests/ai/fixtures/02-with-thread.md`

**Prompt:**

> Add ONE new reply to the existing comment thread (id 1). Author the reply as "Claude". Body: anything reasonable that follows the existing discussion. The reply should land in chronological position (its timestamp should be later than the most recent existing reply).
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Comment 1 gains exactly one new reply (3 replies total — original 2 plus 1).
- New reply's `author = "Claude"`, `timestamp` is ISO 8601 UTC and is strictly newer than the previous most-recent reply's timestamp.
- The file round-trips through the parser.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Three replies in chronological order; final reply by Claude; file round-trips.

---

## AI-WRITE-statechange-01 — resolve all by author

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Mark all comments authored by "Claude" as resolved. Leave comments by other authors untouched. Do not delete any comments.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly; comment count unchanged.
- Every comment with `author = "Claude"` has `resolved: true`.
- Every other comment has `resolved` unchanged from the source.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. id 1 (Claude) → resolved: true; id 2 (Maya) → unchanged.

---

## AI-WRITE-statechange-02 — delete a specific comment

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Delete the comment that asks about the sample composition (it's the one by Claude that mentions the EMEA cohort). Removing a comment per the spec means removing both its YAML record AND its inline marker pair from the body. Leave the other comment intact.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- The comment about the EMEA cohort is gone (id 1 in the source fixture).
- The other comment remains untouched (id 2).
- The body no longer contains the `<!-- fmc:1 -->` / `<!-- /fmc:1 -->` marker pair.
- The body still contains the marker pair for the surviving comment.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. id 1 removed; id 2 intact; body's anchored phrase for id 1 still present as plain prose; markers cleanly stripped.

---

## AI-WRITE-statechange-03 — edit own comment

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Edit the body of the FIRST comment (id 1, by Claude). Add a sentence to the existing body about why the sample composition matters. Set the `edited_at` field to a recent timestamp. Do not change the original `timestamp` field. Do not change any other field.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Comment 1's `timestamp` is unchanged (still `2026-05-07T09:14:00Z`).
- Comment 1's `edited_at` is set and is ISO 8601 UTC.
- Body length grew (original was ~80 chars; expanded version is longer).
- All other fields on comment 1 unchanged.
- Comment 2 untouched.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Original timestamp preserved; `edited_at: 2026-05-08T10:00:00Z` added; body extended with an explanatory sentence.

---

## How to re-run

Same procedure as the AI-READ / AI-WRITE-comment cases: spawn a Claude Code Agent with the relevant fixture, the skill content, and the prompt verbatim. Save the fenced output to `/tmp/forgemark-*.md` and run a parse-and-assert script (the script used during Phase 6 verification is in shell history; the canonical equivalents will live alongside the SDK harness in `tests/ai/cases/state-change.test.ts` once Phase 12 wires it).
