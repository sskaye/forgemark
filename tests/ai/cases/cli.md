# AI-CLI test category

Verifies that an agent given only the skill package uses the bundled tool (`scripts/forgemark.mjs`) for every read and write, never hand-edits the comments block or markers, and hands back a file that passes `forgemark lint`. This is the path the skill now leads with; the hand-editing cases in the other categories remain as the fallback.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`, copied to a scratch path first (the tool writes in place)
- **Skill** — the whole skill directory `assets/forgemark-skill/`, with its path given to the agent
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties of the resulting file and of the agent's behaviour
- **Last run** — captured output from the most recent sub-agent invocation

---

## AI-CLI-01 — address, comment, suggest, lint

**Fixture:** `tests/ai/fixtures/02-with-thread.md`

**Skill:** loaded (directory path given).

**Prompt:**

> Read the existing review comments. Address comment 1: the reviewer asked for absolute numbers. Edit the document prose to add "(38% vs 19%, n=14)" right after the anchored phrase, keeping the comment attached, then reply to the thread as author "Claude" saying what you changed. Add a new comment of your own (author "Claude") on the phrase "controlling for company size" asking which size buckets were used. Add a suggested edit (author "Claude") that changes "seems strong" to "is strong". Run the lint check the skill describes and make sure it passes. Then report the exact commands you ran with exit codes, the final file, and anything in SKILL.md that was unclear or tempted you to edit the block by hand.

**Expectations:**

- Every read and write of comments goes through `forgemark.mjs` (`list`, `show`, `reply`, `comment`, `lint`); the only direct edit to the file is to the prose.
- The file parses strictly; comment count 1 → 3; comment 1 has one more reply, by Claude; comment 3 is a suggestion `{from: "seems strong", to: "is strong"}` with no body.
- The marker pair for comment 1 is intact and its `anchor_text` still matches; `forgemark lint --strict` exits 0.
- No command exits non-zero.

**Last run** (2026-09-03, sub-agent, skill loaded): expectations met. Eleven commands, all exit 0, no stderr; the prose edit was made with `sed` outside the marker pair; final lint `OK — 3 comments (3 attached, 0 orphaned, 0 floating)`. The agent's notes led to four additions to SKILL.md: `--author NAME` shown in the command table rows, a rule for adding text next to an anchor (outside the markers), a note that context fields on existing comments are not refreshed, and that replies are append-only.

---

## How to re-run

Copy the fixture to a scratch path, spawn a Claude Code Agent with the prompt verbatim and the skill directory path, and tell it not to read `src/` or `cli/`. Verify with `node assets/forgemark-skill/scripts/forgemark.mjs lint --strict <scratch file>` and `list --json`.
