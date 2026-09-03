// `forgemark lint` — every invariant the app relies on, checked at the
// moment a file is handed back rather than when a reviewer opens it.
//
// The checks are the ones that have actually bitten, in the order they
// did: the block parses; there is exactly one block; markers and records
// agree one-to-one; anchors don't overlap; floating notes have no
// markers; `anchor_text` still describes what the markers wrap. The
// parser owns the first three (it rejects duplicate keys, duplicate ids,
// and unmatched or recordless markers); this module adds the ones the
// parser tolerates by design and reports them all in one list.
//
// Errors are things the app would refuse or misread. Warnings are things
// the app handles but the reviewer would rather not meet — an orphan
// waiting for reattachment, an anchor description that has drifted.

import { parseForgemarkFile, findStrayBlock, ForgemarkParseError } from "../src/format/parser";
import { findMarkers, pairMarkers } from "../src/format/markers";
import { anchorTextMatches } from "../src/format/anchor-text";
import { BLOCK_OPEN, type DocFormat, type ParsedFile } from "../src/format/types";

export type Problem = {
  severity: "error" | "warning";
  message: string;
  line?: number;
  commentId?: number;
};

export type LintReport = {
  problems: Problem[];
  counts: { comments: number; attached: number; orphaned: number; floating: number };
  file: ParsedFile | null;
};

export function lintText(text: string, format: DocFormat): LintReport {
  const problems: Problem[] = [];
  const counts = { comments: 0, attached: 0, orphaned: 0, floating: 0 };

  let file: ParsedFile;
  try {
    file = parseForgemarkFile(text, { tolerant: true, format });
  } catch (err) {
    if (err instanceof ForgemarkParseError) {
      problems.push({
        severity: "error",
        message: err.message,
        line:
          err.line ?? (err.commentId !== undefined ? recordLine(text, err.commentId) : undefined),
        commentId: err.commentId,
      });
    } else {
      problems.push({ severity: "error", message: (err as Error).message });
    }
    // With no readable structure the remaining checks have nothing to
    // stand on, but a stray block is still worth naming: it is the usual
    // reason the trailing one could not be read.
    const stray = findStrayBlock(text.slice(0, text.lastIndexOf(BLOCK_OPEN)));
    if (stray) {
      problems.push({
        severity: "error",
        line: stray.line,
        message: `A second comments block starts here; a file may have only one, at the very end.`,
      });
    }
    return { problems, counts, file: null };
  }

  const stray = findStrayBlock(file.body);
  if (stray) {
    problems.push({
      severity: "error",
      line: stray.line,
      message: `A second comments block starts here and is ignored by the app; a file may have only one, at the very end. Merge its records into the trailing block.`,
    });
  }

  const { pairs } = pairMarkers(findMarkers(file.body, format));
  const sorted = [...pairs].sort((a, b) => a.open.start - b.open.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.open.start < prev.close.end) {
      problems.push({
        severity: "error",
        commentId: cur.id,
        line: lineAt(file.body, cur.open.start),
        message: `The anchors of comments ${prev.id} and ${cur.id} overlap. Anchors may not overlap or nest; make one of them a reply to the other.`,
      });
    }
  }

  const pairById = new Map(pairs.map((p) => [p.id, p]));
  counts.comments = file.comments.length;
  for (const c of file.comments) {
    const line = recordLine(text, c.id);
    const pair = pairById.get(c.id);

    // The app writes fractional seconds; the spec's example does not.
    // Both are ISO 8601 UTC.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(c.timestamp)) {
      problems.push({
        severity: "warning",
        commentId: c.id,
        line,
        message: `Comment ${c.id}: timestamp "${c.timestamp}" is not ISO 8601 UTC (e.g. 2026-05-07T14:32:00Z).`,
      });
    }

    if (c.floating) {
      counts.floating++;
      if (pair) {
        problems.push({
          severity: "error",
          commentId: c.id,
          line,
          message: `Comment ${c.id} is marked floating but has a marker pair in the body. Remove the markers or drop \`floating: true\`.`,
        });
      }
      continue;
    }

    if (!pair) {
      counts.orphaned++;
      problems.push({
        severity: "warning",
        commentId: c.id,
        line,
        message: `Comment ${c.id} has no marker pair in the body (orphaned). The reviewer will be asked to reattach it; \`forgemark reattach\` or \`forgemark float\` settles it now.`,
      });
      continue;
    }

    counts.attached++;
    if (c.anchor_kind === "element") continue;
    const between = file.body.slice(pair.open.end, pair.close.start);
    if (c.anchor_text !== undefined && !anchorTextMatches(c.anchor_text, between, format)) {
      problems.push({
        severity: "warning",
        commentId: c.id,
        line,
        message:
          `Comment ${c.id}: anchor_text ${JSON.stringify(c.anchor_text)} no longer matches the text between its markers, ` +
          `${JSON.stringify(flat(between))}. The comment is still attached, but recovery after a lost anchor would look for the old text.`,
      });
    }
  }

  return { problems, counts, file };
}

// 1-based line of the `- id: N` line for a record, or undefined.
export function recordLine(text: string, id: number): number | undefined {
  const start = text.lastIndexOf("\n" + BLOCK_OPEN);
  if (start < 0) return undefined;
  const lines = text.split("\n");
  const from = lineAt(text, start + 1) - 1;
  const re = new RegExp(`^- id:\\s*${id}\\s*$`);
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return undefined;
}

function lineAt(s: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function flat(s: string, max = 80): string {
  const f = s.replace(/\s+/g, " ").trim();
  return f.length > max ? f.slice(0, max - 1) + "…" : f;
}
