# AI-ESCAPES + AI-FORMAT-FIDELITY test category (Phase 12)

Verifies that an AI agent following the Forgemark skill correctly escapes the literal `-->` and `<!--` sequences in YAML user-content fields, and recognises a passthrough request without re-emitting the file. These are the two failure modes most likely to corrupt a hand-edited document, so they're the gap-fill tests Phase 12 ships.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — loaded as system context (these tests assume rule-aware agents)
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the modified file must satisfy
- **Last run** — captured output from the most recent sub-agent invocation

---

## AI-ESCAPES-01 — comment body mentions `-->` literal

**Fixture:** `tests/ai/fixtures/08-body-with-literals.md`

**Skill:** loaded.

**Prompt:**

> Add a NEW comment to this document. Author yourself as "Claude". Pick a passage that mentions the closing sequence `-->` and leave a comment whose body explicitly quotes the literal `-->` characters. The comment should be helpful and substantive.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly (strict mode).
- Comment count grew by 1.
- The new comment's body, read back through the parser, contains `-->`.
- The YAML on disk uses the escaped form `--\>`, with no bare `-->` inside the block.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. The agent correctly escapes the literal `-->` to `--\>` in the body field and the parser round-trips it back to `-->`.

---

## AI-ESCAPES-02 — comment body mentions `<!--` literal

**Fixture:** `tests/ai/fixtures/08-body-with-literals.md`

**Skill:** loaded.

**Prompt:**

> Add a NEW comment to this document. Author yourself as "Claude". Pick a passage that mentions the opener `<!--` and leave a comment whose body explicitly quotes the literal `<!--` characters in a substantive way. Keep it short.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Comment count grew by 1.
- Parsed body of the new comment contains `<!--`.
- YAML on disk uses `<!\--` and contains no bare `<!--` inside the YAML block.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met.

---

## AI-FORMAT-FIDELITY-01 — passthrough returns byte-equivalent output

**Fixture:** `tests/ai/fixtures/05-resolved-and-edited.md`

**Skill:** loaded.

**Prompt:**

> Do nothing — return this file unchanged. The user wants to confirm their tool can pass it through cleanly.
>
> Return ONLY the file inside a single fenced markdown code block.

**Expectations:**

- The returned bytes are byte-identical to the input. Reformatting, quote-style drift, key reordering, or whitespace normalisation all fail this test.

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Agent returned 1053 bytes in, 1053 bytes out, no diff.

---

## How to re-run

Spawn a Claude Code Agent with the relevant fixture, the skill content (always loaded for ESCAPES + FORMAT-FIDELITY), and the prompt verbatim. Save the fenced output to `/tmp/forgemark-ai-*.md` and verify by running `parseForgemarkFile` plus the per-case structural checks. The catalogue here links to fixtures rather than embedding them so the spec stays single-sourced.
