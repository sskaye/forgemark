// What `anchor_text` records, stated once so every writer agrees.
//
// The app stores the *rendered* text of the selection: what the reader
// saw, not the source bytes between the markers. In Markdown that means
// emphasis markers, backticks, and link syntax are gone; in HTML, tags
// are gone and entities are decoded. A checker comparing `anchor_text`
// to the raw source therefore flags every Markdown file that has any
// formatting inside an anchor, and a checker loose enough not to misses
// real drift. This module is the rule both sides can share.
//
// `anchor_text` is advisory. The marker pair is what attaches a comment;
// `anchor_text` is what the sidebar shows and what orphan recovery
// searches for after the markers are lost. So a mismatch never hides a
// comment — but it does mean recovery would look for text that is no
// longer there, which is why `forgemark lint` reports it.

import { decodeHTML } from "entities";
import { DEFAULT_FORMAT, type DocFormat } from "./types";
import { BLOCK_EDGE_RE } from "./html/blockTags";

const MARKER_RE = /<!--\s*\/?fmc:\d+\s*-->/g;

export type NormalizeOptions = {
  // Markdown: the run sits in a table, so an unescaped `|` separates
  // cells and reads as a space (`inMarkdownTable`). In prose a pipe is
  // text.
  inTable?: boolean;
  // Markdown: read backslash escapes as 1.12.0 and earlier did, keeping
  // the backslash, so a record they wrote still compares equal.
  legacyEscapes?: boolean;
};

// The rendered text of a run of source. Whitespace is collapsed, so a
// hard-wrapped anchor and its single-line `anchor_text` compare equal,
// and a run across blocks reads as the reader reads it: the edge of an
// HTML block, or the list marker, `>` or `#` that starts a Markdown
// line, is a space.
export function normalizeAnchorText(
  source: string,
  format: DocFormat = DEFAULT_FORMAT,
  opts: NormalizeOptions = {},
): string {
  const withoutMarkers = source.replace(MARKER_RE, "");
  const text =
    format === "html"
      ? renderedHtml(withoutMarkers)
      : renderedMarkdown(withoutMarkers, opts.inTable === true, opts.legacyEscapes === true);
  return collapse(text);
}

// Whether a recorded `anchor_text` describes the given source. The app
// records rendered text, so that is compared first; an agent that
// copied the raw source instead (backticks and all) is accepted too,
// since normalising both sides makes them meet.
export function anchorTextMatches(
  recorded: string,
  source: string,
  format: DocFormat = DEFAULT_FORMAT,
  opts: NormalizeOptions = {},
): boolean {
  const rendered = normalizeAnchorText(source, format, opts);
  if (collapse(recorded) === rendered || normalizeAnchorText(recorded, format, opts) === rendered) {
    return true;
  }
  // Recorded by 1.12.0 or earlier, which kept a Markdown escape's
  // backslash (and lost an escaped `<name>`).
  return (
    format === "markdown" &&
    source.includes("\\") &&
    collapse(recorded) === normalizeAnchorText(source, format, { ...opts, legacyEscapes: true })
  );
}

// A GFM table's delimiter row: `| --- | :-: |`, `---|---`.
const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

// Whether a Markdown source offset lies in a table: the run of
// non-blank lines around it has a header row with a pipe, followed by a
// delimiter row. Top-level tables only, which is where a reader meets
// them in practice.
export function inMarkdownTable(body: string, offset: number): boolean {
  const lineAt = (pos: number) => {
    const start = body.lastIndexOf("\n", pos - 1) + 1;
    const nl = body.indexOf("\n", pos);
    return { start, end: nl < 0 ? body.length : nl };
  };
  const blank = (l: { start: number; end: number }) => body.slice(l.start, l.end).trim() === "";
  let first = lineAt(Math.min(offset, body.length));
  if (blank(first)) return false;
  while (first.start > 0) {
    const prev = lineAt(first.start - 1);
    if (blank(prev)) break;
    first = prev;
  }
  let prevText: string | null = null;
  for (let l = first; ;) {
    const text = body.slice(l.start, l.end);
    if (text.trim() === "") return false;
    if (prevText !== null && prevText.includes("|") && DELIMITER_ROW.test(text)) return true;
    prevText = text;
    if (l.end >= body.length) return false;
    l = lineAt(l.end + 1);
  }
}

// Inline Markdown markup removed, line structure kept. For showing a
// comment body as plain text: emphasis and link syntax go, code spans
// keep their content verbatim, so `snake_case_name` and `a * b * c`
// come through as written.
export function stripMarkdownInline(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => renderedMarkdown(line.replace(/^#+\s+/, "")))
    .join("\n")
    .trim();
}

// A block's edge reads as a space, as the reader sees it (`blockTags.ts`):
// `one</td><td>beta` is "one beta", not "onebeta".
function renderedHtml(s: string): string {
  return decodeHTML(
    s
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(BLOCK_EDGE_RE, " ")
      .replace(/<[^>]+>/g, ""),
  );
}

// Whether a source span crosses the edge of a block — two paragraphs,
// list items, table cells, or a heading and what follows — rather than
// staying inside one. A suggested edit must not: accepting it replaces
// everything between the markers, which would merge the blocks or break
// the table. A hard-wrapped paragraph, quoted or not, is one block.
export function spansBlocks(
  body: string,
  start: number,
  end: number,
  format: DocFormat = DEFAULT_FORMAT,
): boolean {
  const s = body.slice(start, end).replace(MARKER_RE, "");
  if (format === "html") return new RegExp(BLOCK_EDGE_RE.source, "i").test(s);
  return (
    // A blank line, in a quote or not.
    /\n[ \t]*(?:>[ \t]?)*[ \t]*(?:\n|$)/.test(s) ||
    // A new list item or heading, in a quote or not.
    /\n[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|#{1,6}(?:[ \t]|$))/.test(s) ||
    // Out of the heading the span starts in: an ATX heading is one line.
    (s.includes("\n") && /^[ \t]*(?:>[ \t]?)*#{1,6}(?:[ \t]|$)/.test(lineStartAt(body, start))) ||
    // A setext heading's underline.
    /\n[ \t]*(?:=+|-+)[ \t]*(?:\n|$)/.test(s) ||
    // A cell edge.
    (/(?<!\\)\|/.test(s) && inMarkdownTable(body, start))
  );
}

// The first few characters of the line `offset` is on.
function lineStartAt(body: string, offset: number): string {
  const from = body.lastIndexOf("\n", offset - 1) + 1;
  return body.slice(from, from + 32);
}

// The source span of the block a Markdown passage sits in: the row, in a
// table; otherwise the run of lines up to a blank line, a list item's
// marker, or a heading, which is a block of its own.
const LINE_STARTS_BLOCK =
  /^[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|#{1,6}(?:[ \t]|$))/;
const HEADING_LINE = /^[ \t]*(?:>[ \t]?)*[ \t]*#{1,6}(?:[ \t]|$)/;

export function markdownBlockAround(
  body: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const lineStart = (pos: number) => body.lastIndexOf("\n", pos - 1) + 1;
  const lineEnd = (pos: number) => {
    const nl = body.indexOf("\n", pos);
    return nl < 0 ? body.length : nl;
  };
  const line = (from: number) => body.slice(from, lineEnd(from));
  let s = lineStart(start);
  let e = lineEnd(end);
  if (inMarkdownTable(body, start)) return { start: s, end: e };
  while (s > 0 && !LINE_STARTS_BLOCK.test(line(s))) {
    const prev = lineStart(s - 1);
    const text = line(prev);
    if (text.trim() === "" || HEADING_LINE.test(text)) break;
    s = prev;
  }
  if (!HEADING_LINE.test(line(lineStart(e)))) {
    while (e < body.length) {
      const text = line(e + 1);
      if (text.trim() === "" || LINE_STARTS_BLOCK.test(text)) break;
      e = lineEnd(e + 1);
    }
  }
  return { start: s, end: e };
}

// What starts a Markdown line without being text: a quote's `>`, a list
// marker (with its task box), or a heading's `#`s. In a run that crosses
// lines, each reads as the line break before it.
const LINE_START_MARKUP =
  /\n[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}(?=[ \t\n]|$))?/g;

function blockMarkupAsSpace(s: string, inTable: boolean): string {
  const out = s.replace(LINE_START_MARKUP, "\n");
  if (!inTable) return out;
  return out
    .split("\n")
    .filter((line) => !DELIMITER_ROW.test(line) || line.trim() === "")
    .join("\n")
    .replace(/(?<!\\)\|/g, " ");
}

function renderedMarkdown(s: string, inTable = false, legacyEscapes = false): string {
  // A whole-code-block anchor: the markers sit on their own lines around
  // the fence, and the app records the code itself.
  const fence = s.match(/^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\s*\1\s*$/);
  if (fence) return fence[2];
  // A block equation, anchored the same way: the app records the TeX.
  const math = s.match(/^\s*\$\$[ \t]*\n([\s\S]*?)\n\s*\$\$\s*$/);
  if (math) return math[1];

  s = blockMarkupAsSpace(s, inTable);

  // Inline code keeps its content verbatim; everything else is prose
  // whose markup is stripped. Split on code spans so the two are handled
  // apart, and a `*` inside backticks survives.
  const parts = s.split(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 3) {
    out += stripProse(parts[i] ?? "", legacyEscapes);
    if (i + 2 < parts.length) out += parts[i + 2];
  }
  return decodeHTML(out);
}

// An inline equation is kept as written, dollars and all, as the app
// records it: its `_` and `*` are TeX, not emphasis.
function stripProse(s: string, legacyEscapes = false): string {
  const parts = s.split(/(\$[^\s$](?:[^$]*[^\s$])?\$)/);
  return parts.map((p, i) => (i % 2 === 1 ? p : stripInlineMarkup(p, legacyEscapes))).join("");
}

// A backslash before ASCII punctuation makes it a literal character —
// `\<name>` is the text "<name>", not a tag; `\*` is an asterisk, not
// emphasis — and a backslash at the end of a line is a line break. The
// escaped character is set aside while markup is stripped, as a private
// use character, and put back after.
const ESCAPE_RE = /\\([!-/:-@[-`{-~]|\n)/g;
const ESCAPED_RE = /[\uE000-\uE07F]/g;
const setAside = (ch: string) =>
  ch === "\n" ? "\n" : String.fromCharCode(0xe000 + ch.charCodeAt(0));
const putBack = (ch: string) => String.fromCharCode(ch.charCodeAt(0) - 0xe000);

function stripInlineMarkup(s: string, legacyEscapes = false): string {
  if (!legacyEscapes) s = s.replace(ESCAPE_RE, (_m, ch: string) => setAside(ch));
  return (
    s
      // HTML tags and comments.
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // Images and links: keep the alt text / link text. An image with
      // no alt text reads as its file name, as the app records it.
      .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?[^)]*\)/g, (_m, alt: string, src: string) =>
        imageText(alt, src),
      )
      // Obsidian wikilinks and embeds: the label, or the target.
      .replace(/!?\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g, (m, target: string, label?: string) =>
        m.startsWith("!") ? imageText(label ?? "", target) : (label ?? target),
      )
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Strong, strikethrough, and emphasis delimiters. Single `*` / `_`
      // are only stripped where they could open or close emphasis, so
      // snake_case words and arithmetic survive.
      .replace(/\*\*|__|~~/g, "")
      .replace(/(^|[\s(["'])[*_](?=\S)/g, "$1")
      .replace(/(?<=\S)[*_](?=$|[\s)\].,;:!?"'])/g, "")
      .replace(ESCAPED_RE, putBack)
  );
}

// What an image reads as: its alt text, or, with none, its file name.
export function imageText(alt: string, src: string): string {
  return alt.trim() || ((src.split(/[\\/]/).pop() ?? "").split(/[?#]/)[0] ?? "");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
