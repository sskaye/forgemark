# AI-READ test category

Verifies AI agents can read a Forgemark file and answer factual questions about its contents — _without_ loading the skill package. These are baseline tests: if a no-skill model can't answer them, the format itself is too obscure.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties the agent's answer must satisfy
- **Last run** — captured output from the most recent sub-agent invocation, with notes on whether expectations were met

The harness is documented in `docs/implementation-plan.md §2`. Locally, a developer spawns a Claude Code sub-agent with the fixture path and one of the prompts below, then verifies the answer matches expectations.

---

## AI-READ-01 — count and attribution

**Fixture:** `tests/ai/fixtures/01-simple.md`

**Prompt:**

> You are reading a markdown file in an unfamiliar format. Without any external help, just by inspecting the raw text, answer two questions about it.
>
> Here is the file at `tests/ai/fixtures/01-simple.md`. Read it directly, then answer:
>
> 1. How many comments does the file contain, broken down as **open** vs **resolved**?
> 2. Who authored each comment? Give one line per comment: id, author, one-sentence summary of what the comment is about.
>
> Be concise. Under 200 words.

**Expectations:**

- Total comment count is `2` (0 resolved, 2 open).
- Comment id 1 attributed to Claude, mentions the EMEA-cohort / sample-composition concern.
- Comment id 2 attributed to Maya, mentions percentages / the n.

**Last run** (2026-05-08, sub-agent, no skill loaded): expectations met. The agent correctly identified 2 open / 0 resolved, named both authors, summarised both comments accurately.

---

## AI-READ-02 — thread comprehension

**Fixture:** `tests/ai/fixtures/02-with-thread.md`

**Prompt:**

> You are reading a markdown file in an unfamiliar format. Without any external help, just by inspecting the raw text, summarise what is being discussed.
>
> Here is the file at `tests/ai/fixtures/02-with-thread.md`. Read it directly, then:
>
> 1. Identify the comment thread on paragraph 1.
> 2. Summarise the discussion in chronological order — who said what, in two or three sentences total. Mention every participant.
>
> Under 150 words.

**Expectations:**

- Identifies a single comment thread on paragraph 1.
- Mentions both participants (Maya and Claude).
- Order is chronological: Maya opens, Claude replies, Maya replies again.
- Captures the gist: Maya asks for the absolute numbers, Claude fills them in, Maya acknowledges.

**Last run** (2026-05-08, sub-agent, no skill loaded): expectations met. The agent correctly identified the thread on paragraph 1, listed the three messages in chronological order, named both participants, and captured the substance of the exchange.

---

## How to re-run

From a Claude Code session at the repo root, spawn an Agent with one of the prompts above and the indicated fixture. Pass the prompt verbatim. After the agent returns, eyeball the answer against the **Expectations** list and update the **Last run** line if anything regresses.

In a future Phase 12 run, these cases will also have a counterpart in `tests/ai/cases/read.test.ts` that calls the SDK harness for batch verification.
