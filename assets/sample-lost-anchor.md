# Q3 Onboarding Research — recovery demo

This file demonstrates the lost-anchor flow. Comment id 1 still has its
`<!-- fmc:1 -->` markers; comment id 2 in the YAML below references a
passage whose markers have been stripped (as if a generic AI rewrote
the second paragraph and dropped the comment markers).

When you open this file in Forgemark you should see:

- A yellow / muted **lost-anchor banner** at the top of the editor pane
  reading "1 comment lost its anchor."
- Clicking **Recover…** opens the Reattach modal. The modal lists the
  exact-match candidate (the original wording is still present in the
  body), with the option to **Reattach here** to put the markers back,
  **Keep as floating note**, or **Discard**.
- The sidebar groups the orphan into a **LOST ANCHOR · 1** section.

---

Across <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 -->, the strongest predictor of week-two retention was completing a real piece of work — not a tutorial — in the first session.

Teams that scheduled a kickoff with their account engineer retained at roughly twice the rate of self-serve teams. The effect held across company size and industry; the gap actually widened by week four.

<!-- forgemark-comments
- id: 1
  anchor_text: "fourteen interviews with new enterprise customers"
  context_before: Across
  context_after: ", the strongest predictor of week-two retention was completing a real piece of work"
  author: Claude
  timestamp: 2026-05-07T09:14:00Z
  resolved: false
  body: |
    Worth noting the sample composition.
- id: 2
  anchor_text: "retained at roughly twice the rate"
  context_before: "Teams that scheduled a kickoff with their account engineer"
  context_after: "of self-serve teams."
  author: Maya
  timestamp: 2026-05-07T09:31:00Z
  resolved: false
  body: |
    Can we get the actual numbers in here? '~2x' is fine for the abstract but the body should have the percentages and the n.
-->
