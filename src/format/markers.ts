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

import { MARKER_OPEN_RE, MARKER_CLOSE_RE } from "./types";

export type Marker = {
  type: "open" | "close";
  id: number;
  // Absolute byte offset into the body string.
  start: number;
  end: number;
};

export function findMarkers(body: string): Marker[] {
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
