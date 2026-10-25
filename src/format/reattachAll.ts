// Re-attaching every orphaned comment in a file at once.
//
// A regenerated report is the common case: the tool that writes it
// carries the comments block over verbatim, the new body has no markers,
// and every passage comment is orphaned together. Most of them can be put
// back without asking anyone, from what the record already holds; the
// rest need a person, and saying why is half the help.
//
// The rules, per orphan, strongest first:
//
//   1. An element or passage comment with an `anchor_selector`: the
//      element with that id, if the page still has it. Exact.
//   2. Otherwise the recorded `anchor_text`. In an HTML report with an
//      `anchor_scope` — the id of the element the passage sat in — that
//      element decides while it is still on the page: the passage is
//      looked for inside it, and if it is no longer there the comment
//      stays orphaned, even when the same text is elsewhere. A review
//      usually asks for its own text to change; once it has, the old
//      text turning up in another row is a coincidence, not the passage.
//      Only a scope that is gone falls back to the whole page.
//   3. On the page, a copy is taken only if the words recorded around
//      the passage (`context_before`, `context_after`) agree with the
//      words around it now, on at least one side (`surroundings`).
//      Several copies: the one whose surroundings match best (`locate`,
//      `near`), and it must agree too; a tie is left for a person. A
//      record with no surroundings has nothing to check, and attaches by
//      its text alone, which the outcome says.
//   4. Anything else stays orphaned, with the reason: the text is gone
//      (and the closest near match, if any), it is no longer in its
//      element, its surroundings differ, it is ambiguous, it overlaps
//      another anchor, or the element is gone. The record is left as it
//      was, so the next attempt sees what was recorded, not a guess.
//
// Near matches are never attached here. A reworded passage may be the
// same passage or a different one, and the Reattach dialog shows both.
//
// Placement goes through `locate.ts`, the same code that places a new
// comment, so a re-attached marker obeys every rule a new one does (no
// marker inside code, none splitting an HTML entity), and the record's
// anchor fields are refreshed from what was found: an element's current
// caption, the rendered text either side of a passage.
//
// The app's "Reattach all" and the CLI's `reattach --all` both call this.

import type { Comment, DocFormat, ParsedFile } from "./types";
import { findMarkers, pairMarkers } from "./markers";
import {
  AnchorError,
  applyPlacement,
  locateAnchor,
  locateElement,
  locatePassage,
  scopeOfPlacement,
  type Placement,
} from "./locate";
import { enclosingBlockSpan, findBySelector } from "./html/elements";
import { inMarkdownTable, markdownBlockAround, normalizeAnchorText } from "./anchor-text";
import { findCandidates } from "./reattach";

export type ReattachOutcome =
  | {
      id: number;
      outcome: "attached";
      // selector: the recorded element id. scope: the passage, inside
      // the element it recorded as its scope. text: the only copy of the
      // passage, its surroundings agreeing. context: one of several
      // copies, chosen by its surroundings. unchecked: the only copy, for
      // a record with no surroundings to check it against.
      how: "selector" | "scope" | "text" | "context" | "unchecked";
      anchor_text: string;
      // Where it went: the 1-based line of the opening marker.
      line: number;
    }
  | {
      id: number;
      outcome: "orphaned";
      reason:
        | "not-found"
        | "not-in-scope"
        | "surroundings-differ"
        | "ambiguous"
        | "overlap"
        | "no-element"
        | "unplaceable";
      detail: string;
    };

export type ReattachAllOptions = {
  // Look for a near match to name in a "not-found" detail. It costs a
  // fuzzy search per vanished passage; the app, which only needs the
  // count, turns it off.
  explain?: boolean;
};

export function reattachOrphans(
  file: ParsedFile,
  format: DocFormat,
  options: ReattachAllOptions = {},
): { file: ParsedFile; outcomes: ReattachOutcome[] } {
  const explain = options.explain ?? true;
  const { pairs } = pairMarkers(findMarkers(file.body, format));
  const attached = new Set(pairs.map((p) => p.id));
  const orphans = file.comments
    .filter((c) => !c.floating && !attached.has(c.id))
    .sort((a, b) => a.id - b.id);

  // One at a time against the body as it stands, so each placement sees
  // the markers the earlier ones added: two comments can't claim
  // overlapping text, and passages on one element nest as they should.
  let body = file.body;
  const updated = new Map<number, Comment>();
  const outcomes: ReattachOutcome[] = [];
  for (const comment of orphans) {
    const result = placeOrphan(body, comment, format);
    if ("error" in result) {
      outcomes.push(orphaned(comment, result.error, body, format, explain));
      continue;
    }
    if ("refused" in result) {
      outcomes.push({ id: comment.id, outcome: "orphaned", ...result.refused });
      continue;
    }
    const { placement, how } = result;
    // Offsets are into the body before the markers go in.
    const scope = scopeOfPlacement(body, placement, format);
    body = applyPlacement(body, placement, comment.id);
    updated.set(comment.id, withPlacement(comment, placement, scope));
    outcomes.push({
      id: comment.id,
      outcome: "attached",
      how,
      anchor_text: placement.anchor_text,
      line: lineOf(body, placement.start),
    });
  }

  if (updated.size === 0) return { file, outcomes };
  return {
    file: { body, comments: file.comments.map((c) => updated.get(c.id) ?? c) },
    outcomes,
  };
}

type Placed = {
  placement: Placement;
  how: "selector" | "scope" | "text" | "context" | "unchecked";
};
// Found, but not taken: the evidence says it is not the passage.
type Refused = { refused: { reason: "not-in-scope" | "surroundings-differ"; detail: string } };

function placeOrphan(
  body: string,
  comment: Comment,
  format: DocFormat,
): Placed | Refused | { error: AnchorError } {
  const near = { before: comment.context_before ?? "", after: comment.context_after ?? "" };
  try {
    if (format === "html" && comment.anchor_selector) {
      // A passage the report's script draws into an element lives in no
      // source text of its own; the element is the only way back to it.
      const placement =
        comment.anchor_kind === "passage"
          ? locatePassage(body, comment.anchor_selector, comment.anchor_text ?? "", format, near)
          : locateElement(body, comment.anchor_selector, format);
      return { placement, how: "selector" };
    }
    if (comment.anchor_kind === "element" || comment.anchor_kind === "passage") {
      // No usable selector. Matching the caption as text would put the
      // markers around the caption and leave the figure uncommented.
      return {
        error: new AnchorError(
          "This comment is on an element, and its id is unknown.",
          "no-element",
        ),
      };
    }
    const text = comment.anchor_text ?? "";
    const scope =
      format === "html" && comment.anchor_scope ? findBySelector(body, comment.anchor_scope) : null;
    if (scope) {
      try {
        const placement = locateAnchor(body, text, format, { near, within: scope });
        return { placement, how: "scope" };
      } catch (err) {
        if (!(err instanceof AnchorError) || err.code !== "not-found") throw err;
        // The element is still here and no longer holds the passage:
        // the text was changed. A copy elsewhere is another passage.
        return { refused: notInScope(body, text, comment.anchor_scope!, format) };
      }
    }
    const placement = locateAnchor(body, text, format, { near });
    const several = (placement.occurrences ?? 1) > 1;
    const agreement = surroundings(body, format, comment, placement);
    if (agreement === "differ") {
      return { refused: surroundingsDiffer(body, format, text, comment, placement, several) };
    }
    if (agreement === "unknown") return { placement, how: "unchecked" };
    return { placement, how: several ? "context" : "text" };
  } catch (err) {
    if (err instanceof AnchorError) return { error: err };
    throw err;
  }
}

// Whether the words recorded either side of the passage agree with the
// words either side of a copy of it, compared outward from the passage.
//
// What counts is the copy's own block: its table row, paragraph, list
// item or heading (`blockAround`). Every word between the passage and the
// edge of that block must be the recorded one, as far as the recording
// goes. Two words were not enough: in a table the neighbouring cell is
// often the same on many rows ("float > 0"), so a comment moved to
// whichever row shared it. A side with nothing in the block, or nothing
// recorded, tells nothing. One agreeing side is enough — an edit next to
// the passage leaves the other — and a copy whose every telling side
// differs is refused.
//
// When the passage fills its block (a whole code block; a paragraph that
// is only the passage), the block says nothing, and the nearest two words
// outside it decide, as they did before.
function surroundings(
  body: string,
  format: DocFormat,
  comment: Comment,
  placement: Placement,
): "agree" | "differ" | "unknown" {
  const verdicts = compareSides(body, format, comment, placement).map((s) => s.verdict);
  if (verdicts.includes("agrees")) return "agree";
  if (verdicts.includes("differs")) return "differ";
  return "unknown";
}

type SideComparison = {
  which: "before" | "after";
  verdict: "agrees" | "differs" | "unknown";
  // Where they part, counted outward from the passage.
  at?: number;
  recorded: string;
  there: string;
};

function compareSides(
  body: string,
  format: DocFormat,
  comment: Comment,
  placement: Placement,
): SideComparison[] {
  const around = inBlock(body, format, placement);
  // The passage fills its block: the nearest two words outside decide.
  const outside = around.before.length === 0 && around.after.length === 0;
  const there = outside
    ? { before: placement.context_before, after: placement.context_after }
    : around;
  const limit = outside ? 2 : Infinity;
  return (["before", "after"] as const).map((which) => {
    const recorded = (which === "before" ? comment.context_before : comment.context_after) ?? "";
    return { which, recorded, there: there[which], ...side(recorded, there[which], which, limit) };
  });
}

// The text either side of a placement, within its block.
function inBlock(
  body: string,
  format: DocFormat,
  placement: Placement,
): { before: string; after: string } {
  const { start, end } = placement;
  if (format === "html") {
    const block = enclosingBlockSpan(body, start, end);
    if (!block) return { before: "", after: "" };
    return {
      before: normalizeAnchorText(body.slice(block.start, start), "html"),
      after: normalizeAnchorText(body.slice(end, block.end), "html"),
    };
  }
  const block = markdownBlockAround(body, start, end);
  const opts = { inTable: inMarkdownTable(body, start) };
  return {
    before: normalizeAnchorText(body.slice(block.start, start), "markdown", opts),
    after: normalizeAnchorText(body.slice(end, block.end), "markdown", opts),
  };
}

// `limit`: how many words outward must match; by default, all the words
// there are on the copy's side, up to what was recorded.
//
// The recording was cut at a length, not at a word, before 1.12.1, so its
// outermost word may be the end ("ers") or the start ("o") of the word
// that is there.
function side(
  recorded: string,
  there: string,
  which: "before" | "after",
  limit = Infinity,
): { verdict: "agrees" | "differs" | "unknown"; at?: number } {
  const want = words(recorded).map((w) => w.key);
  const have = words(there).map((w) => w.key);
  if (want.length === 0 || have.length === 0) return { verdict: "unknown" };
  if (which === "before") {
    want.reverse();
    have.reverse();
  }
  const need = Math.min(limit, want.length, have.length);
  for (let i = 0; i < need; i++) {
    if (want[i] === have[i]) continue;
    const cut = i === want.length - 1;
    if (cut && (which === "before" ? have[i].endsWith(want[i]) : have[i].startsWith(want[i]))) {
      continue;
    }
    return { verdict: "differs", at: i };
  }
  return { verdict: "agrees" };
}

// The words of a stretch of text, as written and as compared: case,
// surrounding punctuation, and a backslash before punctuation (a
// Markdown escape, recorded as written before 1.12.1) don't count.
function words(s: string): { text: string; key: string }[] {
  return s
    .split(/\s+/)
    .map((text) => ({
      text,
      key: text
        .toLowerCase()
        .replace(/\\(?=[!-/:-@[-`{-~])/g, "")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
    }))
    .filter((w) => w.key.length > 0);
}

function notInScope(
  body: string,
  text: string,
  scope: string,
  format: DocFormat,
): Refused["refused"] {
  let elsewhere = "and nowhere else in the page";
  try {
    const p = locateAnchor(body, text, format);
    elsewhere = `though it appears once elsewhere, at line ${lineOf(body, p.start)}`;
  } catch (err) {
    if (err instanceof AnchorError && err.code === "ambiguous") {
      elsewhere = `though it appears ${err.count} times elsewhere`;
    } else if (!(err instanceof AnchorError)) throw err;
  }
  return {
    reason: "not-in-scope",
    detail: `${quote(text)} is no longer in ${scope}, ${elsewhere}. Its text has probably changed; re-anchor it by hand if it moved.`,
  };
}

function surroundingsDiffer(
  body: string,
  format: DocFormat,
  text: string,
  comment: Comment,
  placement: Placement,
  several: boolean,
): Refused["refused"] {
  const line = lineOf(body, placement.start);
  const where = several
    ? `${quote(text)} appears ${placement.occurrences} times; the closest copy, at line ${line},`
    : `${quote(text)} is in the page once, at line ${line}, but it`;
  // Quote each side that differs, from the passage out to the first
  // word that isn't the recorded one.
  const differing = compareSides(body, format, comment, placement)
    .filter((s) => s.verdict === "differs")
    .map(
      (s) =>
        `${s.which} it "${upTo(s.recorded, s.which, s.at!)}", there "${upTo(s.there, s.which, s.at!)}"`,
    );
  return {
    reason: "surroundings-differ",
    detail: `${where} doesn't have the words recorded around it: ${differing.join("; ")}.`,
  };
}

// The `at`th word of one side outward from the passage, with up to
// three words between it and the passage, and "…" where words are left out.
function upTo(s: string, which: "before" | "after", at: number): string {
  const all = words(s).map((w) => w.text);
  const k = which === "before" ? Math.max(0, all.length - 1 - at) : Math.min(at, all.length - 1);
  const from = which === "before" ? k : Math.max(0, k - 3);
  const to = which === "before" ? Math.min(all.length, k + 4) : k + 1;
  return `${from > 0 ? "…" : ""}${all.slice(from, to).join(" ")}${to < all.length ? "…" : ""}`;
}

// The record as it should read once attached: its anchor fields describe
// what the markers now enclose. Stale context and scope are dropped
// rather than left beside a placement that has none.
function withPlacement(comment: Comment, placement: Placement, scope?: string): Comment {
  const next: Comment = { ...comment };
  delete next.context_before;
  delete next.context_after;
  delete next.anchor_scope;
  if (scope) next.anchor_scope = scope;
  next.anchor_text = placement.anchor_text;
  if (placement.anchor_kind) next.anchor_kind = placement.anchor_kind;
  if (placement.anchor_selector) next.anchor_selector = placement.anchor_selector;
  if (placement.context_before) next.context_before = placement.context_before;
  if (placement.context_after) next.context_after = placement.context_after;
  return next;
}

function orphaned(
  comment: Comment,
  error: AnchorError,
  body: string,
  format: DocFormat,
  explain: boolean,
): ReattachOutcome {
  const text = quote(comment.anchor_text ?? "");
  const id = comment.id;
  switch (error.code) {
    case "ambiguous":
      return {
        id,
        outcome: "orphaned",
        reason: "ambiguous",
        detail: `${text} appears ${error.count ?? "several"} times, and the recorded surroundings don't single one out.`,
      };
    case "overlap":
      return {
        id,
        outcome: "orphaned",
        reason: "overlap",
        detail: `${text} overlaps the anchor of comment ${error.otherId}.`,
      };
    case "no-element":
      return {
        id,
        outcome: "orphaned",
        reason: "no-element",
        detail: comment.anchor_selector
          ? `No element ${comment.anchor_selector} in the page.`
          : error.message,
      };
    case "not-found": {
      let detail = `${text} is no longer in the document.`;
      if (explain) {
        const [best] = findCandidates(body, comment, format);
        if (best && best.rationale === "fuzzy") {
          const similarity = Math.round(((best.score - 0.5) / 0.4) * 100);
          detail += ` Closest: ${quote(best.text)} (${similarity}% similar).`;
        }
      }
      return { id, outcome: "orphaned", reason: "not-found", detail };
    }
    default:
      return { id, outcome: "orphaned", reason: "unplaceable", detail: error.message };
  }
}

function quote(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat);
}

function lineOf(s: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
