// Marker walker. Finds `<!-- fmc:N -->` open and `<!-- /fmc:N -->` close
// markers in a markdown body, but skips regions where they should not be
// interpreted: fenced code blocks (``` or ~~~), inline code spans
// (backticks), and indented code blocks (4-space indent at the start of a
// line in a non-list context).
//
// We don't run a full markdown parser here — the rules are narrow and a
// state machine is faster and more predictable. The only edge cases we
// don't model are: HTML blocks (uncommon), maths fences (`$$`, not GFM),
// and lazy continuation. None affects correctness of marker discovery for
// the cases the proposal cares about.

import { MARKER_OPEN_RE, MARKER_CLOSE_RE, DEFAULT_FORMAT, type DocFormat } from "./types";

export type Marker = {
  type: "open" | "close";
  id: number;
  // Absolute byte offset into the body string.
  start: number;
  end: number;
};

// Entry point. Dispatches to the scanner for the body's language; the
// Markdown one is the historical default so existing callers and tests
// are unaffected.
export function findMarkers(body: string, format: DocFormat = DEFAULT_FORMAT): Marker[] {
  return format === "html" ? findMarkersHtml(body) : findMarkersMarkdown(body);
}

export function findMarkersMarkdown(body: string): Marker[] {
  const out: Marker[] = [];
  const lines = body.split("\n");
  let cursor = 0; // running byte offset to start of current line
  let inFence = false;
  let fenceMarker = ""; // "```" or "~~~" with the original run length
  let prevLineWasBlank = true;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineLen = line.length;

    // Indented code blocks: 4+ leading spaces on a line preceded by a blank
    // line (CommonMark — not in lists, etc.). For our purposes, treating
    // any 4+-space-indented line as code-region is conservative but safe.
    const indentedCode = !inFence && /^ {4,}/.test(line) && (prevLineWasBlank || isBlank(line));

    // Detect fence open / close. Fences are the entire indication line;
    // inline marker comments on the same line as a fence opener are still
    // outside the code region (the fence opens on the next line).
    if (!inFence) {
      const fenceMatch = line.match(/^( *)(`{3,}|~{3,})/);
      if (fenceMatch && fenceMatch[1].length < 4) {
        inFence = true;
        fenceMarker = fenceMatch[2];
        cursor += lineLen + 1;
        prevLineWasBlank = false;
        continue;
      }
    } else {
      // Inside a fence: look for a closing fence on this line.
      const closeMatch = line.match(/^( *)(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1].length < 4 &&
        closeMatch[2][0] === fenceMarker[0] &&
        closeMatch[2].length >= fenceMarker.length
      ) {
        inFence = false;
        fenceMarker = "";
      }
      cursor += lineLen + 1;
      prevLineWasBlank = false;
      continue;
    }

    if (indentedCode) {
      cursor += lineLen + 1;
      prevLineWasBlank = false;
      continue;
    }

    // Walk the line, skipping inline code spans (backtick runs).
    let i = 0;
    while (i < lineLen) {
      const ch = line[i];

      if (ch === "`") {
        // Find the run length, then the matching closing run.
        let runLen = 1;
        while (i + runLen < lineLen && line[i + runLen] === "`") runLen++;
        const target = "`".repeat(runLen);
        const closeIdx = line.indexOf(target, i + runLen);
        if (closeIdx >= 0) {
          i = closeIdx + runLen;
          continue;
        }
        // Unterminated — per CommonMark, treat as literal text. Advance one.
        i++;
        continue;
      }

      // Try to match an open marker at this offset.
      const remainder = line.slice(i);
      const openMatch = remainder.match(/^<!--\s*fmc:(\d+)\s*-->/);
      if (openMatch) {
        out.push({
          type: "open",
          id: Number(openMatch[1]),
          start: cursor + i,
          end: cursor + i + openMatch[0].length,
        });
        i += openMatch[0].length;
        continue;
      }
      const closeMatch = remainder.match(/^<!--\s*\/fmc:(\d+)\s*-->/);
      if (closeMatch) {
        out.push({
          type: "close",
          id: Number(closeMatch[1]),
          start: cursor + i,
          end: cursor + i + closeMatch[0].length,
        });
        i += closeMatch[0].length;
        continue;
      }
      i++;
    }

    cursor += lineLen + 1;
    prevLineWasBlank = isBlank(line);
  }

  return out;
}

// HTML marker walker.
//
// A Forgemark marker *is* an HTML comment, so on the face of it a plain
// regex sweep would do. It won't: two regions of an HTML file contain
// text that looks like markup but isn't parsed as it. Both were measured
// against a real generated report before this scanner was written.
//
//   1. Raw-text elements — `<script>`, `<style>`, `<textarea>`, `<title>`.
//      Their content is CDATA-ish: `<!-- fmc:1 -->` inside a script is a
//      string literal, not a comment. Treating it as an anchor invents a
//      marker with no YAML record, which the parser reports as corruption
//      and which blanks every comment in the file.
//   2. Attribute values — `<p title="<!-- fmc:1 -->">`. Same failure.
//
// Conversely, none of the Markdown scanner's skip rules apply here, and
// one of them is actively harmful: its indented-code rule (4+ leading
// spaces after a blank line) makes markers invisible in HTML, which is
// indented as a matter of course.
//
// This is a scanner, not a parser — it needs to know where a marker may
// legally sit, not what the tree looks like. Element nesting, implied
// tags, and foreign content are all irrelevant to that question.
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

export function findMarkersHtml(body: string): Marker[] {
  const out: Marker[] = [];
  const len = body.length;
  let i = 0;

  while (i < len) {
    if (body[i] !== "<") {
      i++;
      continue;
    }

    // Comment, declaration, or CDATA.
    if (body.startsWith("<!", i)) {
      if (body.startsWith("<!--", i)) {
        const remainder = body.slice(i);
        const openMatch = remainder.match(/^<!--\s*fmc:(\d+)\s*-->/);
        if (openMatch) {
          out.push({
            type: "open",
            id: Number(openMatch[1]),
            start: i,
            end: i + openMatch[0].length,
          });
          i += openMatch[0].length;
          continue;
        }
        const closeMatch = remainder.match(/^<!--\s*\/fmc:(\d+)\s*-->/);
        if (closeMatch) {
          out.push({
            type: "close",
            id: Number(closeMatch[1]),
            start: i,
            end: i + closeMatch[0].length,
          });
          i += closeMatch[0].length;
          continue;
        }
        // Some other comment — skip it whole. An unterminated comment
        // runs to EOF, per the HTML spec's EOF-in-comment rule.
        const end = body.indexOf("-->", i + 4);
        i = end < 0 ? len : end + 3;
        continue;
      }
      if (body.startsWith("<![CDATA[", i)) {
        const end = body.indexOf("]]>", i + 9);
        i = end < 0 ? len : end + 3;
        continue;
      }
      // `<!DOCTYPE …>` and any other bogus declaration.
      const end = body.indexOf(">", i + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }

    // Start or end tag. Anything else after `<` is literal text.
    const tag = readTag(body, i);
    if (!tag) {
      i++;
      continue;
    }
    i = tag.end;

    // A raw-text element's content is skipped wholesale, up to its own
    // end tag (a `</script>` inside a JS string would end it in a real
    // parser too, so matching the spec here costs nothing).
    if (!tag.isEnd && !tag.selfClosing && RAW_TEXT_ELEMENTS.has(tag.name)) {
      const closeIdx = indexOfEndTag(body, tag.name, i);
      i = closeIdx < 0 ? len : closeIdx;
    }
  }

  return out;
}

type TagRead = { name: string; end: number; isEnd: boolean; selfClosing: boolean };

// Read a start/end tag beginning at `start` (which must point at `<`).
// Returns null when this isn't a tag at all. Quoted attribute values are
// tracked so a `>` inside one doesn't end the tag early.
function readTag(s: string, start: number): TagRead | null {
  let i = start + 1;
  const isEnd = s[i] === "/";
  if (isEnd) i++;
  const nameStart = i;
  while (i < s.length && /[A-Za-z0-9:_-]/.test(s[i])) i++;
  if (i === nameStart) return null; // `<` followed by something else
  const name = s.slice(nameStart, i).toLowerCase();

  let quote: string | null = null;
  let selfClosing = false;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === ">") {
      selfClosing = s[i - 1] === "/";
      return { name, end: i + 1, isEnd, selfClosing };
    }
    i++;
  }
  // Unterminated tag — consume to EOF so the caller makes progress.
  return { name, end: s.length, isEnd, selfClosing };
}

// Offset of `</name` at or after `from`, case-insensitively. Returns the
// offset of the `<`, so the caller resumes scanning *at* the end tag and
// reads it normally.
function indexOfEndTag(s: string, name: string, from: number): number {
  const needle = "</" + name;
  const lower = s.toLowerCase();
  return lower.indexOf(needle, from);
}

// Pair markers by id. Returns two outputs: matched pairs (open + close in
// order) and unmatched markers.
export type MarkerPair = { id: number; open: Marker; close: Marker };

export function pairMarkers(markers: Marker[]): { pairs: MarkerPair[]; unmatched: Marker[] } {
  const pairs: MarkerPair[] = [];
  const unmatched: Marker[] = [];
  // For each id, track the most recent un-matched open. A close after that
  // pairs with it. If we see two opens before a close (rare), the second
  // open is unmatched.
  const openByID = new Map<number, Marker>();
  for (const m of markers) {
    if (m.type === "open") {
      const prev = openByID.get(m.id);
      if (prev) unmatched.push(prev);
      openByID.set(m.id, m);
    } else {
      const prev = openByID.get(m.id);
      if (prev) {
        pairs.push({ id: m.id, open: prev, close: m });
        openByID.delete(m.id);
      } else {
        unmatched.push(m);
      }
    }
  }
  for (const m of openByID.values()) unmatched.push(m);
  return { pairs, unmatched };
}

// Helpers for use by the parser when extracting anchor text.
export function anchorTextFor(body: string, pair: MarkerPair): string {
  return body.slice(pair.open.end, pair.close.start);
}

export { MARKER_OPEN_RE, MARKER_CLOSE_RE };

function isBlank(s: string): boolean {
  return /^\s*$/.test(s);
}
