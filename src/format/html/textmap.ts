// Source ↔ rendered-text offset map for HTML bodies.
//
// This is the one genuinely new mechanism HTML review needs. Everything
// downstream — creating an anchor from a selection, reattaching an
// orphan after a report is regenerated, describing an element anchor —
// reduces to the same question: *given a position in the text a reader
// sees, which byte of the source is that?*
//
// Why not just serialize the DOM back out. Inserting marker comment
// nodes into the live document and taking `outerHTML` is the obvious
// shortcut and it is wrong: the browser's serializer re-quotes
// attributes, re-encodes entities, and normalises tags, so every save
// would rewrite the whole file. Forgemark's round-trip guarantee — parse
// then serialize returns the original bytes — would die on the first
// comment, and `git diff` would stop being readable, which is most of
// why the format is plain text in the first place.
//
// So the source string is never rebuilt, only spliced. That requires
// exact byte offsets, which is what this module produces.
//
// Correctness strategy. parse5 gives a spec-correct tree with a source
// span for every text node, and the *decoded* value of that text. We
// decode the raw span ourselves (which is what yields a per-character
// map) and then check our result against parse5's value. Agreement means
// the map is exact by construction; disagreement demotes that one node
// to a coarse mapping that snaps to its boundaries. The oracle is free
// and the failure mode is degradation, not corruption.

import { parse } from "parse5";
import { decodeHTML } from "entities";

// A contiguous run of rendered text and the source span it came from.
export type HtmlTextRun = {
  // Half-open range into HtmlTextMap.text.
  textStart: number;
  textEnd: number;
  // Half-open range into the source string.
  sourceStart: number;
  sourceEnd: number;
  // False when our decode disagreed with parse5 and the run fell back to
  // boundary snapping. Callers that need byte precision (anchor
  // creation) refuse inexact runs; callers that only need to find
  // something (reattach ranking) tolerate them.
  exact: boolean;
};

export type HtmlTextMap = {
  // Everything a reader sees, concatenated in document order. Script,
  // style, title and textarea content is excluded — it is not prose and
  // must never be anchored.
  text: string;
  // Per code unit of `text`: the source offset it starts at, and the
  // source offset just past it. Entities map every code unit they
  // produce onto the whole entity span, which is atomic.
  starts: number[];
  ends: number[];
  runs: HtmlTextRun[];
};

// Elements whose character data is not rendered prose. Anchoring inside
// any of them would put a marker where it is not a comment (see
// `findMarkersHtml`), so they are excluded from the text entirely.
const SKIP_CONTENT = new Set(["script", "style", "title", "textarea", "noscript"]);

type P5Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: P5Node[];
  content?: P5Node; // <template>
  sourceCodeLocation?: { startOffset: number; endOffset: number } | null;
};

export function buildHtmlTextMap(html: string): HtmlTextMap {
  const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node;

  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const runs: HtmlTextRun[] = [];

  const visit = (node: P5Node) => {
    if (node.nodeName === "#text") {
      const loc = node.sourceCodeLocation;
      const value = node.value ?? "";
      if (!loc || value.length === 0) return;
      const raw = html.slice(loc.startOffset, loc.endOffset);
      const decoded = decodeRun(raw, loc.startOffset);
      const textStart = text.length;

      if (decoded.text === value) {
        text += decoded.text;
        for (let i = 0; i < decoded.starts.length; i++) {
          starts.push(decoded.starts[i]);
          ends.push(decoded.ends[i]);
        }
        runs.push({
          textStart,
          textEnd: text.length,
          sourceStart: loc.startOffset,
          sourceEnd: loc.endOffset,
          exact: true,
        });
        return;
      }

      // Our decode disagreed with parse5. Keep parse5's text so the
      // concatenated string still matches what the browser renders —
      // that alignment is what the DOM side depends on — but snap every
      // character to the run's boundaries.
      text += value;
      for (let i = 0; i < value.length; i++) {
        starts.push(loc.startOffset);
        ends.push(loc.endOffset);
      }
      runs.push({
        textStart,
        textEnd: text.length,
        sourceStart: loc.startOffset,
        sourceEnd: loc.endOffset,
        exact: false,
      });
      return;
    }

    const tag = (node.tagName ?? "").toLowerCase();
    if (tag && SKIP_CONTENT.has(tag)) return;
    if (node.content) visit(node.content);
    for (const child of node.childNodes ?? []) visit(child);
  };

  visit(doc);
  return { text, starts, ends, runs };
}

// Decode one raw text span, recording where each produced code unit came
// from. Handles the three things that make raw length differ from
// rendered length: character references, CRLF normalisation, and lone
// carriage returns.
function decodeRun(
  raw: string,
  base: number,
): { text: string; starts: number[]; ends: number[] } {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;

  const push = (chars: string, from: number, to: number) => {
    for (let k = 0; k < chars.length; k++) {
      text += chars[k];
      starts.push(base + from);
      ends.push(base + to);
    }
  };

  while (i < raw.length) {
    const ch = raw[i];

    // The HTML parser normalises newlines before tokenising.
    if (ch === "\r") {
      const width = raw[i + 1] === "\n" ? 2 : 1;
      push("\n", i, i + width);
      i += width;
      continue;
    }

    if (ch === "&") {
      const m = /^&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;?)/.exec(raw.slice(i));
      if (m) {
        const decoded = decodeHTML(m[0]);
        if (decoded !== m[0]) {
          push(decoded, i, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
      // A bare `&` that starts nothing — literal.
    }

    push(ch, i, i + 1);
    i++;
  }

  return { text, starts, ends };
}

// Map a half-open range of rendered text back to a half-open source
// range. Returns null when the range is out of bounds or lands on a run
// whose mapping isn't exact and the caller demanded precision.
export function textRangeToSource(
  map: HtmlTextMap,
  from: number,
  to: number,
  opts: { requireExact?: boolean } = {},
): { start: number; end: number } | null {
  if (from < 0 || to > map.text.length || from >= to) return null;
  if (opts.requireExact && !rangeIsExact(map, from, to)) return null;
  const start = map.starts[from];
  const end = map.ends[to - 1];
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

// True when every run the range touches carries an exact mapping.
export function rangeIsExact(map: HtmlTextMap, from: number, to: number): boolean {
  for (const run of map.runs) {
    if (run.textEnd <= from) continue;
    if (run.textStart >= to) break;
    if (!run.exact) return false;
  }
  return true;
}

// The run containing a given text index, or null.
export function runAt(map: HtmlTextMap, index: number): HtmlTextRun | null {
  for (const run of map.runs) {
    if (index >= run.textStart && index < run.textEnd) return run;
  }
  return null;
}
