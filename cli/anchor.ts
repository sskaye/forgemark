// Turning "this passage" into a marker pair.
//
// The agent names a passage by its text. This module finds it in the
// source, decides where the markers may legally go, and refuses the
// cases the format cannot represent — an ambiguous phrase, a span that
// overlaps an existing anchor, a marker inside a code fence. Every
// refusal is a message the agent can act on, because the alternative is
// an agent guessing at offsets and splitting a marker pair.
//
// Matching is deliberately forgiving about whitespace: source that is
// hard-wrapped, or an HTML report whose prose runs across tags, should
// still be found by the phrase a reader would type.

import { findMarkers, pairMarkers, type MarkerPair } from "../src/format/markers";
import { buildHtmlTextMap, textRangeToSource } from "../src/format/html/textmap";
import { findBySelector } from "../src/format/html/elements";
import { openMarker, closeMarker, type DocFormat } from "../src/format/types";
import { normalizeAnchorText } from "../src/format/anchor-text";
import { contextSnippet } from "../src/format/compose";

export type Placement = {
  // Source offsets the markers wrap. For a block placement the markers
  // go on their own lines around the range.
  start: number;
  end: number;
  block: boolean;
  anchor_text: string;
  context_before: string;
  context_after: string;
  anchor_kind?: "element";
  anchor_selector?: string;
};

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

export type LocateOptions = {
  // Which match to take when the phrase appears more than once (1-based).
  occurrence?: number;
};

// Find `phrase` in `body` and describe where its markers go.
export function locateAnchor(
  body: string,
  phrase: string,
  format: DocFormat,
  opts: LocateOptions = {},
): Placement {
  const needle = phrase.replace(/\s+/g, " ").trim();
  if (needle.length === 0) throw new AnchorError("The anchor text is empty.");
  return format === "html"
    ? locateInHtml(body, needle, opts)
    : locateInMarkdown(body, needle, opts);
}

// Wrap a whole element, named by a selector Forgemark itself writes
// (`#id` or `#id tag`). HTML only — the only way to comment on a chart.
export function locateElement(body: string, selector: string, format: DocFormat): Placement {
  if (format !== "html") {
    throw new AnchorError("--selector applies to HTML reports only; use --anchor for Markdown.");
  }
  const span = findBySelector(body, selector);
  if (!span) {
    throw new AnchorError(
      `No element matches "${selector}". Only "#id" and "#id tag" selectors are supported, and the id must exist in the report.`,
    );
  }
  rejectOverlap(body, span.start, span.end, format);
  const map = buildHtmlTextMap(body);
  const around = renderedAround(map, span.start, span.end);
  return {
    start: span.start,
    end: span.end,
    block: false,
    anchor_text: describeElement(span.text),
    context_before: around.before,
    context_after: around.after,
    anchor_kind: "element",
    anchor_selector: selector.trim(),
  };
}

// Splice the markers for `id` at a placement.
export function applyPlacement(body: string, placement: Placement, id: number): string {
  const open = openMarker(id);
  const close = closeMarker(id);
  const { start, end } = placement;
  if (!placement.block) {
    return body.slice(0, start) + open + body.slice(start, end) + close + body.slice(end);
  }
  // Own-line markers around a fenced block. `start` is the beginning of
  // the fence line and `end` the end of the closing fence line.
  return (
    body.slice(0, start) + open + "\n" + body.slice(start, end) + "\n" + close + body.slice(end)
  );
}

// ── Markdown ──────────────────────────────────────────────────────────

type Region = { start: number; end: number; kind: "fence" | "code" };

function locateInMarkdown(body: string, needle: string, opts: LocateOptions): Placement {
  const regions = codeRegions(body);
  const matches = findMatches(body, needle, markdownTolerant(needle));
  const chosen = pick(matches, needle, opts, body);
  let { start, end } = chosen;

  // A phrase quoted without its emphasis — "company size" for
  // `**company size**`, or "for company size" for `for **company size**`
  // — is widened to take the delimiters with it, so the markers sit
  // outside the emphasis rather than between the text and its `**`.
  ({ start, end } = balanceEmphasis(body, start, end));

  // A match touching a code region is widened to cover the region: a
  // marker inside backticks or a fence would be code, not a comment.
  let block = false;
  for (const r of regions) {
    if (r.end <= start || r.start >= end) continue;
    if (r.kind === "fence") {
      if (start < r.start || end > r.end) {
        throw new AnchorError(
          "The anchor straddles a code block. Anchor the whole block (a phrase inside it) or prose outside it, not both.",
        );
      }
      start = r.start;
      end = r.end;
      block = true;
      break;
    }
    start = Math.min(start, r.start);
    end = Math.max(end, r.end);
  }
  rejectOverlap(body, start, end, "markdown");

  const source = body.slice(start, end);
  return {
    start,
    end,
    block,
    anchor_text: normalizeAnchorText(source, "markdown"),
    context_before: contextSnippet(normalizeAnchorText(body.slice(0, start), "markdown"), "before"),
    context_after: contextSnippet(normalizeAnchorText(body.slice(end), "markdown"), "after"),
  };
}

function balanceEmphasis(body: string, start: number, end: number): { start: number; end: number } {
  const runAfter = body.slice(end).match(/^[*_~]+/)?.[0];
  if (runAfter && body.slice(start, end).includes(runAfter)) end += runAfter.length;
  const runBefore = body.slice(0, start).match(/[*_~]+$/)?.[0];
  if (runBefore && body.slice(start, end).includes(runBefore)) start -= runBefore.length;
  while (
    start > 0 &&
    end < body.length &&
    /[*_~]/.test(body[start - 1]) &&
    body[end] === body[start - 1]
  ) {
    start--;
    end++;
  }
  return { start, end };
}

// Fenced blocks (whole lines, fence to fence) and inline code spans.
function codeRegions(body: string): Region[] {
  const out: Region[] = [];
  const lines = body.split("\n");
  let cursor = 0;
  let fence: { marker: string; start: number } | null = null;
  for (const line of lines) {
    const lineEnd = cursor + line.length;
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence === null) {
      if (m) {
        fence = { marker: m[1], start: cursor };
      } else {
        for (const span of inlineCodeSpans(line)) {
          out.push({ start: cursor + span.start, end: cursor + span.end, kind: "code" });
        }
      }
    } else if (
      m &&
      m[1][0] === fence.marker[0] &&
      m[1].length >= fence.marker.length &&
      /^\s*$/.test(line.slice(m[0].length))
    ) {
      out.push({ start: fence.start, end: lineEnd, kind: "fence" });
      fence = null;
    }
    cursor = lineEnd + 1;
  }
  if (fence) out.push({ start: fence.start, end: body.length, kind: "fence" });
  return out.sort((a, b) => a.start - b.start);
}

function inlineCodeSpans(line: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let run = 1;
    while (line[i + run] === "`") run++;
    const close = line.indexOf("`".repeat(run), i + run);
    if (close < 0) {
      i += run;
      continue;
    }
    out.push({ start: i, end: close + run });
    i = close + run;
  }
  return out;
}

// A regex for the phrase where any whitespace in the phrase matches any
// run of whitespace in the source, and, for Markdown, inline markup may
// sit between words — so "twice the rate" finds "twice the **rate**".
function markdownTolerant(needle: string): RegExp {
  return phraseRegex(needle, "(?:[\\s*_~`]|<[^>]+>)+", "gi");
}

function phraseRegex(needle: string, separator: string, flags = "g"): RegExp {
  const words = needle.split(" ").map(escapeRegex);
  const first = needle[0];
  const last = needle[needle.length - 1];
  const lead = /\w/.test(first) ? "(?<!\\w)" : "";
  const tail = /\w/.test(last) ? "(?!\\w)" : "";
  return new RegExp(lead + words.join(separator) + tail, flags);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Match = { start: number; end: number; text: string };

function findMatches(haystack: string, needle: string, tolerant?: RegExp): Match[] {
  // Tiers, strictest first, and only the first tier with any match
  // counts — so an exact phrase is never reported as ambiguous because
  // of a looser cousin elsewhere: exact (whitespace-collapsed), then
  // case-insensitive, then markup-tolerant.
  const exact = collect(haystack, phraseRegex(needle, "\\s+"));
  if (exact.length > 0) return exact;
  const folded = collect(haystack, phraseRegex(needle, "\\s+", "gi"));
  if (folded.length > 0) return folded;
  return tolerant ? collect(haystack, tolerant) : [];
}

function collect(haystack: string, re: RegExp): Match[] {
  const out: Match[] = [];
  for (const m of haystack.matchAll(re)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, text: m[0] });
  }
  return out;
}

function pick(matches: Match[], needle: string, opts: LocateOptions, haystack: string): Match {
  if (matches.length === 0) {
    throw new AnchorError(
      `"${needle}" was not found. Quote the passage exactly as it appears; line breaks and inline formatting are ignored.`,
    );
  }
  if (opts.occurrence !== undefined) {
    const m = matches[opts.occurrence - 1];
    if (!m) {
      throw new AnchorError(
        `--occurrence ${opts.occurrence} is out of range: "${needle}" appears ${matches.length} time(s).`,
      );
    }
    return m;
  }
  if (matches.length > 1) {
    const listing = matches
      .map((m, i) => `  ${i + 1}. line ${lineOf(haystack, m.start)}: …${preview(haystack, m)}…`)
      .join("\n");
    throw new AnchorError(
      `"${needle}" appears ${matches.length} times. Add --occurrence N to pick one, or quote a longer passage:\n${listing}`,
    );
  }
  return matches[0];
}

function lineOf(s: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function preview(haystack: string, m: Match): string {
  const from = Math.max(0, m.start - 30);
  const to = Math.min(haystack.length, m.end + 30);
  return haystack.slice(from, to).replace(/\s+/g, " ");
}

// ── HTML ──────────────────────────────────────────────────────────────

function locateInHtml(body: string, needle: string, opts: LocateOptions): Placement {
  const map = buildHtmlTextMap(body);
  const matches = findMatches(map.text, needle);
  const chosen = pick(matches, needle, opts, map.text);
  const range = textRangeToSource(map, chosen.start, chosen.end, { requireExact: true });
  if (!range) {
    throw new AnchorError(
      `"${needle}" was found, but its source could not be mapped exactly (an unusual entity nearby). Quote a slightly different span.`,
    );
  }
  rejectOverlap(body, range.start, range.end, "html");
  const around = renderedAround(map, range.start, range.end);
  return {
    start: range.start,
    end: range.end,
    block: false,
    anchor_text: normalizeAnchorText(body.slice(range.start, range.end), "html"),
    context_before: around.before,
    context_after: around.after,
  };
}

// Rendered text either side of a source range, for the context fields.
function renderedAround(
  map: ReturnType<typeof buildHtmlTextMap>,
  start: number,
  end: number,
): { before: string; after: string } {
  let firstText = map.text.length;
  let lastText = 0;
  for (let i = 0; i < map.starts.length; i++) {
    if (map.ends[i] <= start) continue;
    if (map.starts[i] >= end) break;
    firstText = Math.min(firstText, i);
    lastText = Math.max(lastText, i + 1);
  }
  if (firstText > lastText) {
    firstText = 0;
    lastText = 0;
  }
  return {
    before: contextSnippet(map.text.slice(0, firstText).replace(/\s+/g, " "), "before"),
    after: contextSnippet(map.text.slice(lastText).replace(/\s+/g, " "), "after"),
  };
}

// The caption if the element has one, else a table's first heading,
// else its text, else its tag — the same preference the app applies
// when a reader clicks a figure.
function describeElement(outerHtml: string): string {
  const tag = outerHtml.match(/^<([A-Za-z][\w-]*)/)?.[1].toLowerCase() ?? "element";
  const caption = outerHtml.match(/<(figcaption|caption)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (caption) {
    const text = normalizeAnchorText(caption[2], "html");
    if (text) return truncate(text);
  }
  const heading = outerHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
  if (heading) {
    const text = normalizeAnchorText(heading[1], "html");
    if (text) return truncate(`${tag}: ${text}`);
  }
  const text = normalizeAnchorText(outerHtml, "html");
  if (text) return truncate(text);
  return tag;
}

function truncate(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// ── shared ────────────────────────────────────────────────────────────

// The format cannot represent overlapping or nested anchors. A span that
// touches an existing pair is refused with the advice the app gives in
// the same situation: reply to that comment instead.
function rejectOverlap(body: string, start: number, end: number, format: DocFormat): void {
  const { pairs } = pairMarkers(findMarkers(body, format));
  const hit = pairs.find((p) => overlaps(p, start, end));
  if (hit) {
    throw new AnchorError(
      `That passage overlaps the anchor of comment ${hit.id}. Reply to comment ${hit.id} instead, or anchor a passage that doesn't overlap it.`,
    );
  }
}

function overlaps(p: MarkerPair, start: number, end: number): boolean {
  return start < p.close.end && end > p.open.start;
}
