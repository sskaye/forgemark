# AI-RECOVERY test category (Phase 9)

Verifies the lost-anchor recovery flow surfaces correctly when external editing breaks anchors. The Forgemark parser runs in **tolerant mode** for the file open path so non-floating comments missing their marker pair are kept (and surfaced as orphans by `classifyAnchors`) instead of being dropped on a hard parse error.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — whether the Forgemark skill is loaded as system context (matters for whether the agent acts naively or rule-aware)
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the modified file must satisfy under the tolerant parser + classifier
- **Last run** — captured output from the most recent sub-agent invocation

---

## AI-RECOVERY-01 — naive paragraph rewrite drops markers; affected comment surfaces as orphan

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Skill:** NOT loaded (agent acts as a generic writer).

**Prompt:**

> Extensively rewrite the SECOND paragraph (the one about teams scheduling kickoffs with their account engineer). Make it more specific and add a concrete number. Don't worry about preserving any structure — just write better prose.
>
> Return ONLY the modified file inside a single fenced markdown code block.

The agent is instructed to treat HTML comments as decorative — exactly what a generic AI writing tool would do.

**Expectations:**

- File parses cleanly under tolerant mode.
- 2 comments preserved.
- Comment id 1 status = `attached` (markers intact in untouched first paragraph).
- Comment id 2 status = `orphaned` (markers stripped during the rewrite).

**Last run** (2026-05-08, sub-agent, no skill): expectations met. Tolerant parser kept both comments; id 2 surfaced as orphaned.

---

## AI-RECOVERY-02 — convert orphan to floating note (skill loaded)

**Fixture:** `tests/ai/fixtures/04-orphan-and-floating.md`

**Skill:** loaded (agent follows Forgemark rules).

**Prompt:**

> Convert comment id 1 from an anchored comment to a floating note. Per the spec: set `floating: true`, remove the inline marker pair (`<!-- fmc:1 -->` and `<!-- /fmc:1 -->`) from the body, and clear `anchor_text` / `context_before` / `context_after`. The comment object stays in the YAML block, just with `floating: true` and no anchor metadata. Leave comment id 2 alone (already floating).
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly.
- Comment id 1 has `floating: true` and no `anchor_text`.
- Body no longer contains `<!-- fmc:1 -->` markers.
- `classifyAnchors` returns `floating` for id 1.
- Comment id 2 unchanged (still floating).

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. Both ids classified as floating; markers stripped.

---

## AI-RECOVERY-03 — naive paragraph deletion strands comment; orphan surfaces with zero recovery candidates

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Skill:** NOT loaded (agent acts as a generic editor).

**Prompt:**

> Delete the SECOND paragraph entirely (the one about teams scheduling kickoffs with their account engineer). The findings are inconclusive and we want to remove that claim. Leave the first paragraph and the trailing HTML comment block at the bottom alone.
>
> Return ONLY the modified file inside a single fenced markdown code block.

The agent deletes the whole line — markers and all — but is explicitly told to leave the YAML block alone, exercising the realistic case where the YAML record outlives the body it described.

**Expectations:**

- File parses cleanly under tolerant mode.
- 2 comments preserved.
- Comment id 1 status = `attached` (first paragraph wasn't touched).
- Comment id 2 status = `orphaned` with `candidates.length === 0` (entire paragraph + markers gone, no recovery possible — modal will only offer Keep as floating / Discard).

**Last run** (2026-05-08, sub-agent, no skill): expectations met. Tolerant parser accepted the file; id 2 surfaced as orphan with zero candidates.

---

## How to re-run

Same procedure as the other AI categories: spawn a Claude Code Agent with the relevant fixture, the skill content (or not, per the case), and the prompt verbatim. Save the fenced output to `/tmp/forgemark-ai-recovery-NN.md` and verify by running the tolerant parser plus `classifyAnchors`.
