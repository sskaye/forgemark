# AI-CONFLICT test category (Phase 10)

Verifies the file-conflict pipeline's behaviour when an AI sub-agent edits the on-disk file while a human has the file open in the app. The pipeline is:

1. File watcher fires (services/fileWatcher).
2. Conflict detection compares baseline vs. new bytes via fingerprint (services/conflict).
3. If different, the tolerant parser parses the new bytes.
4. `externalChangeDetected` is dispatched.
5. Either the file-conflict banner (clean) or edit-during-open modal (dirty) surfaces.
6. ⌘S during a conflict opens the save-conflict modal.

This category exercises step 3 (tolerant parsing of the agent's output) and step 4's payload shape (the diff signals the save-conflict modal would compute). Steps 1, 5, 6 are exercised by the integration tests in `tests/integration/file-conflict.test.tsx`.

For each case:

- **Fixture** — file under `tests/ai/fixtures/`
- **Skill** — whether the Forgemark skill is loaded
- **Prompt** — natural-language task to send the agent
- **Expectations** — properties of the resulting file under the tolerant parser
- **Last run** — captured output from the most recent sub-agent invocation

---

## AI-CONFLICT-01 — collaborative edit while human reviews

**Fixture:** `tests/ai/fixtures/02-with-thread.md`

**Skill:** loaded.

**Prompt:**

> While Maya is reviewing this in the app, please add a NEW comment of your own (id: max+1, author: Claude) to the second paragraph of the body, raising a substantive concern. Also add a reply to the existing thread (id 1) acknowledging Maya's earlier point.
>
> Return ONLY the modified file inside a single fenced markdown code block.

**Expectations:**

- File parses cleanly under tolerant mode.
- Comment count grew by exactly 1 (1 → 2).
- Comment 1's replies grew by exactly 1.
- Body changed (a new marker pair was inserted).
- Diff signals are non-zero — the conflict pipeline would classify this as "changed" and the save-conflict modal would show "Comments: 1 added on disk, Body bytes: changed".

**Last run** (2026-05-08, sub-agent, skill loaded): expectations met. The agent introduced a new second paragraph to host the new anchor (preserving the marker / record 1:1 invariant) and added a reply to id 1.

---

## How to re-run

Spawn a Claude Code Agent with the relevant fixture, the skill content, and the prompt verbatim. Save the fenced output to `/tmp/forgemark-ai-conflict-NN.md` and verify by running `parseForgemarkFile(text, { tolerant: true })` over both versions and computing the diff signals (comments added/removed, body changed).
