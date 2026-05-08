import { describe, it, expect } from "vitest";
import {
  parseForgemarkFile,
  serializeForgemarkFile,
  insertMarkersIntoBody,
  nextCommentId,
  type Comment,
} from "../../src/format";

// Phase 13 end-to-end performance smoke. Mirrors the storyboard:
//
//   1. Parse a 30,000-word annotated file with 50 existing comments.
//   2. Add 5 new comments via the compose path.
//   3. Serialize ("save").
//   4. Re-parse from the serialized bytes ("reopen").
//
// Total elapsed must be under 10 seconds on a base M1 / equivalent
// Windows machine. The number is generous on purpose — the format
// layer is much faster, but this gate guards against accidental
// O(N²) regressions in any of the pure-data paths.
//
// The test pre-builds the inputs outside the timed region, so what
// we measure is the steady-state cost of parse → serialize → parse,
// not the test scaffolding.

function buildAnnotatedFixture(): string {
  // Roughly 30k words of synthetic prose — short repeated sentences
  // with anchored phrases sprinkled in. A real document has more
  // structural variety, but the parser doesn't care about prose
  // shape; it cares about marker count and YAML record count.
  const sentences = [
    "Across the year, the team measured retention with a mix of qualitative and quantitative inputs.",
    "Onboarding interviews surfaced themes the dashboards alone did not.",
    "Customers who scheduled a kickoff retained at higher rates over the trailing four weeks.",
    "The tour redesign showed no measurable effect on the second-week return rate.",
    "Reviewers across departments raised similar questions about the activation definition.",
  ];
  const words: string[] = [];
  let s = 0;
  while (words.length < 30000) {
    words.push(...sentences[s % sentences.length].split(/\s+/));
    s++;
  }
  let body = words.join(" ") + "\n";

  // Insert 50 marker pairs around contiguous 4-word slices spaced
  // out across the body. Walk the joined body and pick anchor
  // positions deterministically so the YAML records can match.
  const anchors: { from: number; to: number; text: string }[] = [];
  const step = Math.floor(body.length / 60);
  for (let i = 1; i <= 50; i++) {
    const center = step * i;
    // Find a clean word boundary near `center`.
    const left = body.lastIndexOf(" ", center) + 1;
    const right = body.indexOf(" ", center + 30);
    const from = left;
    const to = right === -1 ? Math.min(body.length, center + 30) : right;
    anchors.push({ from, to, text: body.slice(from, to) });
  }
  // Insert markers in reverse-position order so earlier offsets
  // stay valid as later ones are spliced.
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    body = insertMarkersIntoBody(body, a.from, a.to, i + 1);
  }

  // Build matching YAML records.
  const comments: Comment[] = anchors.map((a, i) => ({
    id: i + 1,
    anchor_text: a.text,
    author: i % 2 === 0 ? "Maya" : "Claude",
    timestamp: "2026-05-07T09:00:00Z",
    resolved: false,
    body: `Comment ${i + 1} body — synthetic content for the perf smoke.\n`,
  }));

  return serializeForgemarkFile({ body, comments });
}

describe("Phase 13 end-to-end perf smoke", () => {
  it("30k-word file × 50 existing comments + 5 new + save + reopen completes in < 10s", () => {
    const seedText = buildAnnotatedFixture();
    const t0 = performance.now();

    // Parse — "open".
    const parsed = parseForgemarkFile(seedText);
    expect(parsed.comments).toHaveLength(50);

    // Add 5 more comments. Each insertion mutates the body to
    // include a fresh marker pair around an unanchored slice.
    let body = parsed.body;
    const comments = [...parsed.comments];
    for (let i = 0; i < 5; i++) {
      // Pick a body-relative offset that's unlikely to land inside
      // an existing marker. The fixture has anchors interspersed,
      // so we just walk past the last existing close-marker.
      const id = nextCommentId(comments);
      const insertAt = Math.min(body.length - 50, 200 + i * 100);
      const from = body.indexOf(" ", insertAt) + 1;
      const to = body.indexOf(" ", from + 30);
      const text = body.slice(from, to);
      body = insertMarkersIntoBody(body, from, to, id);
      comments.push({
        id,
        anchor_text: text,
        author: "Claude",
        timestamp: "2026-05-08T08:00:00Z",
        resolved: false,
        body: `Added in the perf smoke.\n`,
      });
    }
    expect(comments).toHaveLength(55);

    // Serialize — "save".
    const saved = serializeForgemarkFile({ body, comments });

    // Re-parse — "reopen".
    const reparsed = parseForgemarkFile(saved);
    expect(reparsed.comments).toHaveLength(55);

    const ms = performance.now() - t0;
    // Generous bound: the storyboard target is 10s including UI
    // paint; the format-layer-only path should beat it by orders
    // of magnitude. We assert under 5s here so a future regression
    // fails loudly rather than creeping toward the visible gate.
    expect(ms).toBeLessThan(5000);
  }, 20_000);
});
