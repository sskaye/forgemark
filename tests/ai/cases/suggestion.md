# AI-WRITE-suggestion test category

Verifies AI agents can drive the suggested-edit lifecycle: propose a new suggestion, accept (terminal — body changes), reject (terminal — body preserved). Both Accept and Reject also strip the inline marker pair and remove the YAML record, per spec §117.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — `assets/forgemark-skill/SKILL.md` is loaded as system context
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the modified file must satisfy
- **Last run** — captured output from the most recent sub-agent invocation, with notes on whether expectations were met

---

## AI-WRITE-suggestion-01 — propose a new suggested edit

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> Add a NEW suggested edit to this document. Pick the second sentence (the one mentioning "retained at roughly twice the rate") and propose a tighter rewording — keep the meaning but make it more concrete or specific. Author yourself as "Claude". Use a recent ISO 8601 UTC timestamp. The suggestion should reuse the existing anchor at id 2 OR introduce a new comment with its own marker pair (your choice — both are valid; just be correct).
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- New comment has a `suggested_edit` object with `from` and `to`.
- Exactly one new suggestion was added (either a new id, or `suggested_edit` was added to id 2).
- Every non-floating YAML record has a matching marker pair.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Agent introduced a new id 3 with markers nested inside id 2's existing markers around the same anchor text. The parser accepts nested markers; both anchors resolve. Body suggestion: "retained at a 2.1x higher week-two rate".

---

## AI-WRITE-suggestion-02 — accept a suggestion (terminal)

**Fixture:** `tests/ai/fixtures/03-suggestion.md`

**Prompt:**

> Accept the suggested edit in this file. Per the Forgemark format, accepting a suggestion is a terminal operation: replace the anchored text in the body with the suggestion's `to` value AND remove the comment object from the YAML block AND remove its inline marker pair. The comments block becomes empty after this — when there are no comments left, the trailing `<!-- forgemark-comments ... -->` block is omitted entirely (clean files stay clean).
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Zero comments in the parsed result.
- Body contains the new wording (`to` value).
- Body does NOT contain the old wording (`from` value).
- Body does NOT contain `fmc:1` markers.
- File does NOT contain a trailing `forgemark-comments` block.

**Last run** (2026-05-08, sub-agent, skill loaded): all six expectations met.

---

## AI-WRITE-suggestion-03 — reject a suggestion (terminal, body preserved)

**Fixture:** `tests/ai/fixtures/03-suggestion.md`

**Prompt:**

> Reject the suggested edit in this file. Per the Forgemark format, rejecting a suggestion is also terminal: leave the anchored text in the body UNCHANGED, but remove the comment object from the YAML block AND strip its inline marker pair (so the anchored text remains as plain prose). The comments block becomes empty afterward — when there are no comments left, the trailing block is omitted entirely.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Zero comments in the parsed result.
- Body STILL contains the original wording (`from` value).
- Body does NOT contain the suggested replacement (`to` value).
- Body does NOT contain `fmc:1` markers.
- File does NOT contain a trailing `forgemark-comments` block.

**Last run** (2026-05-08, sub-agent, skill loaded): all six expectations met.

---

## How to re-run

Same procedure as the other AI categories: spawn a Claude Code Agent with the relevant fixture, the skill content, and the prompt verbatim. Save the fenced output to `/tmp/forgemark-*.md` and verify by running `parseForgemarkFile` over the bytes plus the per-case structural checks.
