// The operations the CLI exposes, as pure functions over a parsed file.
//
// Each takes `{ body, comments }` and returns a new one plus a one-line
// summary. Nothing here touches the disk or the clock — `main.ts` does
// the reading, writing, and timestamping — so every operation can be
// tested on a string. The app's own format layer does all the real
// work; this module only sequences it, which is the point: an agent
// using these never composes YAML or places a marker by hand.

import type { Comment, DocFormat, ParsedFile, Reply } from "../src/format/types";
import { nextCommentId, removeMarkersFromBody } from "../src/format/compose";
import { classifyAnchors, type AnchorStatus } from "../src/format/reattach";
import { findMarkers, pairMarkers } from "../src/format/markers";
import { applyPlacement, locateAnchor, locateElement, AnchorError, type Placement } from "./anchor";

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export type Result = { file: ParsedFile; summary: string; id: number };

export type CommentInput = {
  author: string;
  body?: string;
  // One of the three ways to place the comment.
  anchor?: string;
  selector?: string;
  floating?: boolean;
  occurrence?: number;
  // Makes it a suggestion: the anchored text is `from`, this is `to`.
  suggest?: string;
  now: string;
};

export function addComment(file: ParsedFile, format: DocFormat, input: CommentInput): Result {
  const ways = [input.anchor, input.selector, input.floating ? "floating" : undefined].filter(
    (w) => w !== undefined,
  );
  if (ways.length !== 1) {
    throw new CommandError("Give exactly one of --anchor, --selector, or --floating.");
  }
  if (input.suggest !== undefined && input.anchor === undefined) {
    throw new CommandError("--suggest needs --anchor: a suggestion replaces the anchored text.");
  }
  const body = input.body?.trim() ? input.body : undefined;
  if (body === undefined && input.suggest === undefined) {
    throw new CommandError("A comment needs a body (--body, --body-file, or stdin).");
  }

  const id = nextCommentId(file.comments);
  const record: Comment = {
    id,
    author: input.author,
    timestamp: input.now,
    resolved: false,
  };
  if (body !== undefined) record.body = ensureNewline(body);

  if (input.floating) {
    record.floating = true;
    const comments = [...file.comments, record];
    return { file: { body: file.body, comments }, summary: `Added floating note #${id}.`, id };
  }

  const placement = place(file.body, format, input);
  const newBody = applyPlacement(file.body, placement, id);
  fillAnchorFields(record, placement);

  if (input.suggest !== undefined) {
    const from = file.body.slice(placement.start, placement.end);
    if (placement.block || placement.anchor_kind === "element") {
      throw new CommandError(
        "A suggestion can replace a run of text, not a code block or an element.",
      );
    }
    if (format === "html" && from.includes("<")) {
      throw new CommandError(
        "A suggestion in an HTML report must not span tags: accepting it would replace markup. Anchor a span with no tags inside.",
      );
    }
    record.suggested_edit = { from, to: input.suggest };
  }

  const comments = [...file.comments, record];
  const what = input.suggest !== undefined ? "suggestion" : "comment";
  return {
    file: { body: newBody, comments },
    summary: `Added ${what} #${id} on "${truncate(placement.anchor_text)}".`,
    id,
  };
}

export function addReply(
  file: ParsedFile,
  id: number,
  input: { author: string; body: string; now: string },
): Result {
  const target = find(file, id);
  if (!input.body.trim()) throw new CommandError("A reply needs a body.");
  const reply: Reply = {
    author: input.author,
    timestamp: input.now,
    body: ensureNewline(input.body),
  };
  const comments = file.comments.map((c) =>
    c.id === id ? { ...c, replies: [...(c.replies ?? []), reply] } : c,
  );
  const n = (target.replies?.length ?? 0) + 1;
  return {
    file: { body: file.body, comments },
    summary: `Replied to #${id} (${n} ${n === 1 ? "reply" : "replies"} in thread).`,
    id,
  };
}

export function setResolved(file: ParsedFile, id: number, resolved: boolean): Result {
  find(file, id);
  const comments = file.comments.map((c) => (c.id === id ? { ...c, resolved } : c));
  return {
    file: { body: file.body, comments },
    summary: `${resolved ? "Resolved" : "Reopened"} #${id}.`,
    id,
  };
}

export function deleteComment(file: ParsedFile, id: number): Result {
  find(file, id);
  return {
    file: {
      body: removeMarkersFromBody(file.body, id),
      comments: file.comments.filter((c) => c.id !== id),
    },
    summary: `Deleted #${id} and its markers.`,
    id,
  };
}

// Turn a comment into a floating note: markers out, anchor fields
// cleared, the way the app's Reattach dialog does it.
export function floatComment(file: ParsedFile, id: number): Result {
  const target = find(file, id);
  if (target.floating) throw new CommandError(`#${id} is already a floating note.`);
  const comments = file.comments.map((c) => {
    if (c.id !== id) return c;
    const next: Comment = { ...c, floating: true };
    delete next.anchor_text;
    delete next.anchor_kind;
    delete next.anchor_selector;
    delete next.context_before;
    delete next.context_after;
    return next;
  });
  return {
    file: { body: removeMarkersFromBody(file.body, id), comments },
    summary: `#${id} is now a floating note.`,
    id,
  };
}

// Give an orphaned or floating comment a new anchor.
export function reattachComment(
  file: ParsedFile,
  format: DocFormat,
  id: number,
  input: { anchor?: string; selector?: string; occurrence?: number },
): Result {
  find(file, id);
  const { pairs } = pairMarkers(findMarkers(file.body, format));
  if (pairs.some((p) => p.id === id)) {
    throw new CommandError(`#${id} is already anchored. Delete it or float it first to move it.`);
  }
  if ((input.anchor === undefined) === (input.selector === undefined)) {
    throw new CommandError("Give exactly one of --anchor or --selector.");
  }
  const placement = place(file.body, format, input);
  const body = applyPlacement(file.body, placement, id);
  const comments = file.comments.map((c) => {
    if (c.id !== id) return c;
    const next: Comment = { ...c };
    delete next.floating;
    delete next.anchor_kind;
    delete next.anchor_selector;
    fillAnchorFields(next, placement);
    return next;
  });
  return {
    file: { body, comments },
    summary: `Reattached #${id} to "${truncate(placement.anchor_text)}".`,
    id,
  };
}

// ── reading ───────────────────────────────────────────────────────────

export type Listed = {
  comment: Comment;
  status: AnchorStatus["kind"];
  // What currently sits between the markers, for attached comments.
  current?: string;
};

export function listComments(file: ParsedFile, format: DocFormat): Listed[] {
  const status = classifyAnchors(file.body, file.comments, format);
  return file.comments.map((comment) => {
    const st = status.get(comment.id) ?? { kind: "floating" as const };
    const entry: Listed = { comment, status: st.kind };
    if (st.kind === "attached") {
      const { pairs } = pairMarkers(findMarkers(file.body, format));
      const pair = pairs.find((p) => p.id === comment.id);
      if (pair) entry.current = file.body.slice(pair.open.end, pair.close.start);
    }
    return entry;
  });
}

// ── helpers ───────────────────────────────────────────────────────────

function find(file: ParsedFile, id: number): Comment {
  const c = file.comments.find((x) => x.id === id);
  if (!c) {
    const ids = file.comments.map((x) => x.id).join(", ") || "none";
    throw new CommandError(`No comment #${id} in this file (ids: ${ids}).`);
  }
  return c;
}

function place(
  body: string,
  format: DocFormat,
  input: { anchor?: string; selector?: string; occurrence?: number },
): Placement {
  try {
    if (input.selector !== undefined) return locateElement(body, input.selector, format);
    return locateAnchor(body, input.anchor ?? "", format, { occurrence: input.occurrence });
  } catch (err) {
    if (err instanceof AnchorError) throw new CommandError(err.message);
    throw err;
  }
}

function fillAnchorFields(record: Comment, placement: Placement): void {
  record.anchor_text = placement.anchor_text;
  if (placement.anchor_kind) record.anchor_kind = placement.anchor_kind;
  if (placement.anchor_selector) record.anchor_selector = placement.anchor_selector;
  if (placement.context_before) record.context_before = placement.context_before;
  if (placement.context_after) record.context_after = placement.context_after;
}

// Bodies are written as YAML block literals, which end in a newline;
// storing them that way keeps the record byte-identical to what the app
// writes for the same text.
function ensureNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}

function truncate(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}
