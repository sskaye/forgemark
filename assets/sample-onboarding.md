# Q3 Customer Onboarding — what we learned

## Key findings

We ran <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 --> in the first six weeks of the quarter. The strongest predictor of week-two retention turned out to be something quieter than the dashboards suggest: completing a real piece of work — not a tutorial, not a sample notebook — in the very first session. Among teams that finished a concrete output by the end of their first hour, week-two return rates were roughly twice those of teams that left the session with only a tour completed.

A second, weaker signal: teams that scheduled a kickoff with their account engineer <!-- fmc:2 -->retained at roughly twice the rate<!-- /fmc:2 --> of self-serve teams over weeks two through four. The effect held across company size and industry; it was strongest where the team's first project involved data they brought with them rather than the demo dataset.

## What surprised us

- The product tour, redesigned three months ago, had no measurable effect on retention. <!-- fmc:3 -->Customers described it as "the part you skim before getting to the actual thing"<!-- /fmc:3 --> in three separate interviews.
- Teams that hit a stuck-state in the first session were _more_ likely to return than teams that breezed through, provided the stuck-state was resolved within the same session — typically by their account engineer or by the in-app help.
- Slack-based handoffs from sales to onboarding were a quiet drag: when the engineer wasn't pre-briefed, sessions ran ~12 minutes longer with no improvement in outcome.

## Open questions

We did not study churn in detail; the sample is too small to separate <!-- fmc:4 -->onboarding-driven churn<!-- /fmc:4 --> from later product issues. The Q1 study used a different definition of activation, so the comparisons are loose. We should re-run with a tighter cohort in Q4 before drawing harder conclusions.

<!-- forgemark-comments
- id: 1
  anchor_text: "fourteen interviews with new enterprise customers"
  context_before: "We ran"
  context_after: "in the first six weeks of the quarter."
  author: Claude
  timestamp: 2026-05-07T09:14:00Z
  resolved: false
  body: |
    Worth noting the sample composition — were these all from the EMEA cohort, or mixed? The retention claim reads stronger if we say so up front.
  replies:
    - author: Maya
      timestamp: 2026-05-07T10:22:00Z
      body: |
        Mixed — 9 NA, 4 EMEA, 1 APAC. I'll add the breakdown.
- id: 2
  anchor_text: "retained at roughly twice the rate"
  context_before: "Teams that scheduled a kickoff with their account engineer"
  context_after: "of self-serve teams over weeks two through four."
  author: Maya
  timestamp: 2026-05-07T09:31:00Z
  resolved: false
  body: |
    Can we get the actual numbers in here? "~2x" is fine for the abstract but the body should have the percentages and the n.
- id: 3
  anchor_text: "Customers described it as \"the part you skim before getting to the actual thing\""
  context_before: "The product tour, redesigned three months ago, had no measurable effect on retention."
  context_after: "in three separate interviews."
  author: Claude
  timestamp: 2026-05-07T09:48:00Z
  resolved: false
  body: |
    Tighter, less colloquial. Same shape.
  suggested_edit:
    from: "Customers described it as \"the part you skim before getting to the actual thing\""
    to: "Customers consistently described it as the warm-up before the real work starts"
- id: 4
  anchor_text: "onboarding-driven churn"
  context_before: "the sample is too small to separate"
  context_after: "from later product issues."
  author: Devon
  timestamp: 2026-05-07T11:05:00Z
  resolved: false
  body: |
    Worth defining "onboarding-driven" before Q4 — we used week-3 last cycle and it gave us very different numbers than the team's mental model.
- id: 5
  floating: true
  author: Claude
  timestamp: 2026-05-08T08:30:00Z
  resolved: false
  body: |
    Cross-referencing the appendix data — there is a third cohort (the design-partners pilot) worth a paragraph but no obvious passage to attach this to. Flag for the next revision.
-->
