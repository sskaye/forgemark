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

const MARKER_RE = /<!--\s*\/?fmc:\d+\s*-->/g;

// The rendered text of a run of source. Whitespace is collapsed, so a
// hard-wrapped anchor and its single-line `anchor_text` compare equal.
export function normalizeAnchorText(source: string, format: DocFormat = DEFAULT_FORMAT): string {
  const withoutMarkers = source.replace(MARKER_RE, "");
  const text = format === "html" ? renderedHtml(withoutMarkers) : renderedMarkdown(withoutMarkers);
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
): boolean {
  const rendered = normalizeAnchorText(source, format);
  return collapse(recorded) === rendered || normalizeAnchorText(recorded, format) === rendered;
}

function renderedHtml(s: string): string {
  return decodeHTML(s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, ""));
}

function renderedMarkdown(s: string): string {
  // A whole-code-block anchor: the markers sit on their own lines around
  // the fence, and the app records the code itself.
  const fence = s.match(/^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\s*\1\s*$/);
  if (fence) return fence[2];

  // Inline code keeps its content verbatim; everything else is prose
  // whose markup is stripped. Split on code spans so the two are handled
  // apart, and a `*` inside backticks survives.
  const parts = s.split(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 3) {
    out += stripInlineMarkup(parts[i] ?? "");
    if (i + 2 < parts.length) out += parts[i + 2];
  }
  return decodeHTML(out);
}

function stripInlineMarkup(s: string): string {
  return (
    s
      // HTML tags and comments.
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // Images and links: keep the alt text / link text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Strong, strikethrough, and emphasis delimiters. Single `*` / `_`
      // are only stripped where they could open or close emphasis, so
      // snake_case words and arithmetic survive.
      .replace(/\*\*|__|~~/g, "")
      .replace(/(^|[\s(["'])[*_](?=\S)/g, "$1")
      .replace(/(?<=\S)[*_](?=$|[\s)\].,;:!?"'])/g, "")
  );
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
