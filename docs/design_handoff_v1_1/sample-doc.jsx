// sample-doc.jsx — Sample annotated document for the prototype.
// Renders the document body as JSX (rather than parsing markdown) so we can
// place anchor markers exactly. Each anchored span has data-anchor-id="N".
// Comments live alongside in INITIAL_COMMENTS.

window.SAMPLE_DOC_TITLE = "Q3 Onboarding Research — Findings";
window.SAMPLE_DOC_FILENAME = "Q3 Onboarding — Findings.md";

// Anchor helper — used inside the rendered prose to wrap commented passages.
// The actual markdown source uses <!-- fmc:N -->…<!-- /fmc:N --> markers.
window.SampleDoc = function SampleDoc({ Anchor }) {
  return (
    <article className="fm-prose">
      <h1>Q3 Onboarding Research — Findings</h1>
      <p className="fm-byline">
        Draft · Maya Chen · revised by Claude · 7 May 2026
      </p>

      <p>
        Across <Anchor id={1}>fourteen interviews with new enterprise
        customers</Anchor>, the strongest predictor of week-two retention was
        whether the team completed a real piece of work — not a tutorial — in
        the first session. Tutorial completion alone was uncorrelated with
        retention, replicating the finding from the Q1 study.
      </p>

      <h2>What worked</h2>

      <p>
        Teams who scheduled a kickoff with their account engineer{" "}
        <Anchor id={2}>retained at roughly twice the rate</Anchor> of
        self-serve teams, even after controlling for company size and prior
        familiarity with similar tools. The kickoff itself is a thin signal;
        what matters is the artifact it produces.
      </p>

      <p>
        Three behaviors showed up in every successful onboarding we observed:
      </p>

      <ul>
        <li>
          A named owner on the customer side who could approve workspace-level
          decisions without escalation.
        </li>
        <li>
          A first integration that touched <Anchor id={3}>production data,
          not staging</Anchor> — the stakes raised attention.
        </li>
        <li>
          Documentation read in the same session as setup, not after.
        </li>
      </ul>

      <h2>What didn't</h2>

      <p>
        The in-product tour, redesigned in February, has a 71% completion rate
        but does not move the retention needle. Reviewers consistently
        described it as <Anchor id={4}>"the part you skim before getting to
        the actual thing"</Anchor>. We should consider retiring it or
        repositioning it as reference material.
      </p>

      <p>
        Teams that started with a sandbox workspace stalled more often than
        teams that started directly in their production workspace. Sandbox
        environments invited experimentation but did not produce artifacts
        anyone wanted to keep.
      </p>

      <h2>Recommendations</h2>

      <p>
        The Q3 plan should commit to{" "}
        <Anchor id={5}>three changes</Anchor> based on these findings:
      </p>

      <ol>
        <li>
          Replace the in-product tour with a one-page orientation embedded in
          the empty workspace itself.
        </li>
        <li>
          Make the kickoff scheduling step the default for new enterprise
          accounts, with self-serve as the explicit alternative.
        </li>
        <li>
          Retire the sandbox-first onboarding path; route every new account
          straight into a production workspace with a clear "first import"
          affordance.
        </li>
      </ol>

      <p>
        None of these are large engineering investments. The largest cost is
        coordination with the field team, which already runs informally for
        the top accounts. Formalizing it should free more of their time, not
        less.
      </p>

      <h2>Open questions</h2>

      <p>
        We did not study churn in detail; the sample is too small and our
        instrumentation too coarse to separate{" "}
        <Anchor id={6}>onboarding-driven churn</Anchor> from later product
        issues. A follow-up study with a larger sample and better behavioral
        data is the natural next step.
      </p>

      <p className="fm-end-rule">— END —</p>
    </article>
  );
};

// Initial comments — covers all card states the brief calls out.
window.INITIAL_COMMENTS = [
  {
    id: 1,
    anchor_text: "fourteen interviews with new enterprise customers",
    author: "Claude",
    timestamp: "2026-05-07T09:14:00Z",
    resolved: false,
    body: "Worth surfacing the sample composition here — were these all from the EMEA cohort, or mixed? It changes how the kickoff finding generalizes.",
    replies: [],
    state: "unread", // unread | read | has-unread-replies
  },
  {
    id: 2,
    anchor_text: "retained at roughly twice the rate",
    author: "Maya",
    timestamp: "2026-05-07T09:31:00Z",
    resolved: false,
    body: "Can we get the actual numbers in here? '~2x' is fine for the abstract but the body should have the percentages and the n.",
    replies: [
      {
        author: "Claude",
        timestamp: "2026-05-07T09:42:00Z",
        body: "Filled in 38% (kickoff) vs 19% (self-serve), n=14. Edit pending in next revision.",
      },
    ],
    state: "has-unread-replies",
  },
  {
    id: 3,
    anchor_text: "production data, not staging",
    author: "Devon",
    timestamp: "2026-05-06T22:12:00Z",
    resolved: true,
    body: "I think this is the single most counter-intuitive finding. Worth pulling up to the summary.",
    replies: [
      {
        author: "Maya",
        timestamp: "2026-05-07T08:01:00Z",
        body: "Agreed — moved to summary in v3.",
      },
    ],
    state: "read",
  },
  {
    id: 4,
    anchor_text: '"the part you skim before getting to the actual thing"',
    author: "Maya",
    timestamp: "2026-05-07T09:48:00Z",
    edited_at: "2026-05-07T09:55:00Z",
    resolved: false,
    suggested_edit: {
      from: '"the part you skim before getting to the actual thing"',
      to: '"the warm-up before the real work starts"',
    },
    body: "Tighter, less colloquial. Same shape.",
    replies: [],
    state: "read",
  },
  {
    id: 5,
    anchor_text: "three changes",
    author: "Claude",
    timestamp: "2026-05-07T10:02:00Z",
    resolved: false,
    body: "Two of these (kickoff default, retire sandbox) are reversible in a sprint; the tour replacement is not. Should the recommendation order them by reversibility instead of impact?",
    replies: [],
    state: "read",
  },
  {
    id: 6,
    // Orphaned — anchor_text drifted from the body. The renderer treats this
    // as questioned: shows in sidebar's Orphaned section, distinct dashed style.
    anchor_text: "onboarding-driven churn (specifically week-3)",
    author: "Devon",
    timestamp: "2026-05-06T17:40:00Z",
    resolved: false,
    body: "Was the original window week-3 or month-1? The anchor changed since I left this comment. Mark resolved or update.",
    replies: [],
    state: "read",
    orphaned: true,
  },
];
