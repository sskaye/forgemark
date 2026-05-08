// One-shot generator for the seven Phase 3 fixtures.
//
// Usage: `npx tsx scripts/generate-fixtures.ts`
//
// Each fixture is built programmatically from a `{ body, comments }` shape
// then serialized via the canonical serializer. The fixture *is* what
// the serializer produces, which guarantees byte-identical round-trip
// (the parity gate).
//
// To regenerate after a serializer change: re-run this script and commit.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeForgemarkFile } from "../src/format/serializer";
import type { ParsedFile } from "../src/format/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = resolve(__dirname, "..", "tests", "ai", "fixtures");

const fixtures: { name: string; build: () => ParsedFile }[] = [
  // 01 — simple: 2 plain comments, no replies, no suggestions
  {
    name: "01-simple.md",
    build: () => ({
      body: [
        "# Q3 Onboarding Research",
        "",
        "Across <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 -->, the strongest predictor of week-two retention was completing a real piece of work — not a tutorial — in the first session.",
        "",
        "Teams that scheduled a kickoff with their account engineer <!-- fmc:2 -->retained at roughly twice the rate<!-- /fmc:2 --> of self-serve teams.",
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: "fourteen interviews with new enterprise customers",
          context_before: "Across",
          context_after:
            ", the strongest predictor of week-two retention was completing a real piece of work",
          author: "Claude",
          timestamp: "2026-05-07T09:14:00Z",
          resolved: false,
          body: "Worth surfacing the sample composition — were these all from the EMEA cohort, or mixed?\n",
        },
        {
          id: 2,
          anchor_text: "retained at roughly twice the rate",
          context_before: "Teams that scheduled a kickoff with their account engineer",
          context_after: "of self-serve teams.",
          author: "Maya",
          timestamp: "2026-05-07T09:31:00Z",
          resolved: false,
          body: "Can we get the actual numbers in here? '~2x' is fine for the abstract but the body should have the percentages and the n.\n",
        },
      ],
    }),
  },

  // 02 — threaded comment with two replies (chronological)
  {
    name: "02-with-thread.md",
    build: () => ({
      body: [
        "# Onboarding follow-up",
        "",
        "The kickoff finding seems strong: teams who scheduled a kickoff <!-- fmc:1 -->retained at twice the rate<!-- /fmc:1 -->, even after controlling for company size.",
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: "retained at twice the rate",
          context_before: "teams who scheduled a kickoff",
          context_after: ", even after controlling for company size.",
          author: "Maya",
          timestamp: "2026-05-07T09:31:00Z",
          resolved: false,
          body: "Can we add the absolute numbers? n and percentages.\n",
          replies: [
            {
              author: "Claude",
              timestamp: "2026-05-07T09:42:00Z",
              body: "Filled in 38% (kickoff) vs 19% (self-serve), n=14. Edit pending in next revision.\n",
            },
            {
              author: "Maya",
              timestamp: "2026-05-07T09:55:00Z",
              body: "Looks good — the n is small but the gap is large enough to be worth flagging.\n",
            },
          ],
        },
      ],
    }),
  },

  // 03 — suggested edit (from / to)
  {
    name: "03-suggestion.md",
    build: () => ({
      body: [
        "# What didn't work",
        "",
        'The in-product tour was described as <!-- fmc:1 -->"the part you skim before getting to the actual thing"<!-- /fmc:1 -->.',
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: '"the part you skim before getting to the actual thing"',
          context_before: "The in-product tour was described as",
          context_after: ".",
          author: "Maya",
          timestamp: "2026-05-07T09:48:00Z",
          resolved: false,
          body: "Tighter, less colloquial. Same shape.\n",
          suggested_edit: {
            from: '"the part you skim before getting to the actual thing"',
            to: '"the warm-up before the real work starts"',
          },
        },
      ],
    }),
  },

  // 04 — orphan + floating note
  {
    name: "04-orphan-and-floating.md",
    build: () => ({
      body: [
        "# Open questions",
        "",
        "We did not study churn in detail; the sample is too small to separate <!-- fmc:1 -->onboarding-driven churn<!-- /fmc:1 --> from later product issues.",
        "",
        "The Q1 study used a different definition of activation, so the comparisons are loose.",
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          // Drift: anchor_text mentions a phrase that no longer matches
          // what's between the markers exactly. The walker still finds the
          // pair so this validates as a regular (non-floating) comment, but
          // the application's reattach pipeline (Phase 9) flags it as
          // orphaned for the user.
          anchor_text: "onboarding-driven churn (specifically week-3)",
          context_before: "the sample is too small to separate",
          context_after: "from later product issues.",
          author: "Devon",
          timestamp: "2026-05-06T17:40:00Z",
          resolved: false,
          body: "Was the original window week-3 or month-1? The anchor changed since I left this comment.\n",
        },
        {
          id: 2,
          floating: true,
          author: "Claude",
          timestamp: "2026-05-08T11:00:00Z",
          resolved: false,
          body: "Cross-referencing the appendix data — there's a third cohort worth a paragraph but no obvious passage to attach this to.\n",
        },
      ],
    }),
  },

  // 05 — resolved + edited (with edited_at)
  {
    name: "05-resolved-and-edited.md",
    build: () => ({
      body: [
        "# Recommendations",
        "",
        "Replace the in-product tour with <!-- fmc:1 -->a one-page orientation embedded in the empty workspace<!-- /fmc:1 -->.",
        "",
        "Make the kickoff scheduling step the default for new enterprise <!-- fmc:2 -->accounts<!-- /fmc:2 -->.",
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: "a one-page orientation embedded in the empty workspace",
          context_before: "Replace the in-product tour with",
          context_after: ".",
          author: "Devon",
          timestamp: "2026-05-06T22:12:00Z",
          resolved: true,
          body: "I think this is the single most counter-intuitive recommendation. Worth pulling up to the summary.\n",
          replies: [
            {
              author: "Maya",
              timestamp: "2026-05-07T08:01:00Z",
              body: "Agreed — moved to summary in v3.\n",
            },
          ],
        },
        {
          id: 2,
          anchor_text: "accounts",
          context_before: "Make the kickoff scheduling step the default for new enterprise",
          context_after: ".",
          author: "Maya",
          timestamp: "2026-05-07T09:48:00Z",
          edited_at: "2026-05-07T09:55:00Z",
          resolved: false,
          body: "Should we say 'paid accounts' instead, to be precise about which segment?\n",
        },
      ],
    }),
  },

  // 06 — escapes: body / anchor_text containing --> and <!--
  {
    name: "06-escapes.md",
    build: () => ({
      body: [
        "# Edge cases",
        "",
        "Sometimes a body contains the literal HTML-comment opener <!-- fmc:1 -->in a discussion of syntax<!-- /fmc:1 -->.",
        "",
        "The arrow shape <!-- fmc:2 -->reads as a transition<!-- /fmc:2 --> in some prose styles.",
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: "in a discussion of syntax",
          context_before: "Sometimes a body contains the literal HTML-comment opener",
          context_after: ".",
          author: "Claude",
          timestamp: "2026-05-08T10:00:00Z",
          resolved: false,
          body: "If we explain the format, the body needs to render <!-- like this --> safely.\n",
        },
        {
          id: 2,
          anchor_text: "reads as a transition",
          context_before: "The arrow shape",
          context_after: "in some prose styles.",
          author: "Maya",
          timestamp: "2026-05-08T10:05:00Z",
          resolved: false,
          body: "An arrow like x --> y appears occasionally in technical writing.\n",
        },
      ],
    }),
  },

  // 07 — suggestion with no body
  {
    name: "07-empty-body-suggestion.md",
    build: () => ({
      body: [
        "# Polish pass",
        "",
        'Replace <!-- fmc:1 -->"utilise"<!-- /fmc:1 --> with the simpler word.',
        "",
      ].join("\n"),
      comments: [
        {
          id: 1,
          anchor_text: '"utilise"',
          context_before: "Replace",
          context_after: "with the simpler word.",
          author: "Maya",
          timestamp: "2026-05-08T11:30:00Z",
          resolved: false,
          // body is intentionally absent — the suggestion stands alone.
          suggested_edit: {
            from: '"utilise"',
            to: '"use"',
          },
        },
      ],
    }),
  },
];

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const f of fixtures) {
  const text = serializeForgemarkFile(f.build());
  const path = resolve(FIXTURE_DIR, f.name);
  writeFileSync(path, text, "utf-8");
  console.log(`wrote ${path} (${text.length} bytes)`);
}
