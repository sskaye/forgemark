// parseForgemarkFile — extract the body and comments[] from a Forgemark
// markdown file. Symmetric with serializer.ts; round-trip parity is the
// Phase 3 hard gate.
//
// Algorithm:
//   1. Locate the trailing comments block (`<!-- forgemark-comments\n...\n-->`).
//   2. Split the file into `body` (everything before the block) and the
//      raw YAML payload between the sentinel lines.
//   3. Parse the YAML into Comment objects.
//   4. Walk the body for paired `<!-- fmc:N -->` markers (skipping code).
//   5. Validate cross-record invariants: id uniqueness, marker ↔ YAML
//      one-to-one, anchor_text required unless floating.

import { parse as parseYAML } from "yaml";
import { unescapeContent } from "./escape";
import { findMarkers, pairMarkers } from "./markers";
import {
  BLOCK_OPEN,
  COMMENT_KEY_ORDER,
  REPLY_KEY_ORDER,
  SUGGESTED_EDIT_KEY_ORDER,
  type Comment,
  type ParsedFile,
  type Reply,
  type SuggestedEdit,
} from "./types";

export class ForgemarkParseError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = "ForgemarkParseError";
    this.kind = kind;
  }
}

// Locate the comments block. It opens with `<!-- forgemark-comments` on
// its own line near the end of the file. We require it to be at the END
// of the file (only optional trailing whitespace allowed after the close).
type BlockLocation = {
  body: string; // text up to and including the newline before the open sentinel
  yaml: string; // YAML text between the sentinels (no leading/trailing fence)
  trailingNewline: string; // any whitespace after the closing `-->`
};

function locateBlock(input: string): BlockLocation | null {
  // Search for the open sentinel as a complete line. We use the literal
  // string and check that it lives at line-start (or BOF).
  const idx = input.lastIndexOf(BLOCK_OPEN);
  if (idx < 0) return null;
  if (idx > 0 && input[idx - 1] !== "\n") return null;
  // The open must end with the rest of its line being only whitespace —
  // anything after `<!-- forgemark-comments` on the same line is invalid.
  const afterOpen = idx + BLOCK_OPEN.length;
  const eol = input.indexOf("\n", afterOpen);
  if (eol < 0) return null;
  const openTail = input.slice(afterOpen, eol);
  if (!/^\s*$/.test(openTail)) return null;

  // Find a closing `-->` that lives on its own line at the end of the file.
  // Walk lines from the end backwards until we find one matching `-->`.
  const after = input.slice(eol + 1);
  // Trim trailing whitespace; the close line must be the last non-empty.
  const trimmed = after.replace(/\s+$/, "");
  const trailingNewline = after.slice(trimmed.length);
  const lastNL = trimmed.lastIndexOf("\n");
  const lastLine = lastNL < 0 ? trimmed : trimmed.slice(lastNL + 1);
  if (lastLine.trim() !== "-->") return null;
  const yaml = lastNL < 0 ? "" : trimmed.slice(0, lastNL);

  return {
    body: input.slice(0, idx),
    yaml,
    trailingNewline,
  };
}

export function parseForgemarkFile(input: string): ParsedFile {
  const block = locateBlock(input);
  if (!block) {
    return { body: input, comments: [] };
  }
  const comments = parseCommentsYAML(block.yaml);
  validateAgainstBody(block.body, comments);
  return { body: block.body, comments };
}

function parseCommentsYAML(yaml: string): Comment[] {
  if (!yaml.trim()) return [];
  let raw: unknown;
  try {
    raw = parseYAML(yaml);
  } catch (err) {
    throw new ForgemarkParseError("yaml", `Malformed comments YAML: ${(err as Error).message}`);
  }
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ForgemarkParseError("yaml", "Comments block must be a YAML list of comment objects");
  }
  return raw.map((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ForgemarkParseError("schema", `Comment #${i + 1}: expected an object`);
    }
    return parseCommentRecord(entry as Record<string, unknown>, i);
  });
}

function parseCommentRecord(raw: Record<string, unknown>, index: number): Comment {
  const idValue = raw["id"];
  if (typeof idValue !== "number" || !Number.isInteger(idValue) || idValue < 1) {
    throw new ForgemarkParseError(
      "schema",
      `Comment #${index + 1}: 'id' must be a positive integer (got ${JSON.stringify(idValue)})`,
    );
  }

  const author = raw["author"];
  if (typeof author !== "string" || author.length === 0) {
    throw new ForgemarkParseError("schema", `Comment id=${idValue}: 'author' is required`);
  }
  const timestamp = raw["timestamp"];
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    throw new ForgemarkParseError("schema", `Comment id=${idValue}: 'timestamp' is required`);
  }

  const floating = raw["floating"];
  if (floating !== undefined && typeof floating !== "boolean") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'floating' must be a boolean if present`,
    );
  }

  const anchorText = raw["anchor_text"];
  if (anchorText !== undefined && typeof anchorText !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'anchor_text' must be a string if present`,
    );
  }
  if (!floating && !anchorText) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'anchor_text' is required unless floating: true`,
    );
  }

  const resolved = raw["resolved"];
  if (resolved !== undefined && typeof resolved !== "boolean") {
    throw new ForgemarkParseError("schema", `Comment id=${idValue}: 'resolved' must be a boolean`);
  }

  const body = raw["body"];
  if (body !== undefined && typeof body !== "string") {
    throw new ForgemarkParseError("schema", `Comment id=${idValue}: 'body' must be a string`);
  }
  const suggested = raw["suggested_edit"];
  if (body === undefined && (!suggested || typeof suggested !== "object")) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'body' is required for plain comments (suggestions may omit it)`,
    );
  }

  const editedAt = raw["edited_at"];
  if (editedAt !== undefined && typeof editedAt !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'edited_at' must be a string if present`,
    );
  }
  const contextBefore = raw["context_before"];
  if (contextBefore !== undefined && typeof contextBefore !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'context_before' must be a string if present`,
    );
  }
  const contextAfter = raw["context_after"];
  if (contextAfter !== undefined && typeof contextAfter !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${idValue}: 'context_after' must be a string if present`,
    );
  }

  const replies = parseReplies(raw["replies"], idValue);
  const suggestedEdit = parseSuggestedEdit(raw["suggested_edit"], idValue);

  // Forward-compat: capture unknown keys.
  const known = new Set<string>(COMMENT_KEY_ORDER);
  const additionalKeys: Record<string, unknown> = {};
  let hasUnknown = false;
  for (const k of Object.keys(raw)) {
    if (!known.has(k)) {
      additionalKeys[k] = raw[k];
      hasUnknown = true;
    }
  }

  const out: Comment = {
    id: idValue,
    author,
    timestamp,
    resolved: resolved === true,
  };
  if (floating === true) out.floating = true;
  if (anchorText !== undefined) out.anchor_text = unescapeContent(anchorText);
  if (contextBefore !== undefined) out.context_before = unescapeContent(contextBefore);
  if (contextAfter !== undefined) out.context_after = unescapeContent(contextAfter);
  if (editedAt !== undefined) out.edited_at = editedAt;
  if (body !== undefined) out.body = unescapeContent(body);
  if (suggestedEdit) out.suggested_edit = suggestedEdit;
  if (replies.length > 0) out.replies = replies;
  if (hasUnknown) out.additionalKeys = additionalKeys;

  return out;
}

function parseReplies(raw: unknown, parentId: number): Reply[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ForgemarkParseError("schema", `Comment id=${parentId}: 'replies' must be a list`);
  }
  return raw.map((entry, i) => parseReplyRecord(entry, parentId, i));
}

function parseReplyRecord(raw: unknown, parentId: number, index: number): Reply {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId} reply #${index + 1}: expected an object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const author = obj["author"];
  const timestamp = obj["timestamp"];
  const body = obj["body"];
  if (typeof author !== "string" || author.length === 0) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId} reply #${index + 1}: 'author' is required`,
    );
  }
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId} reply #${index + 1}: 'timestamp' is required`,
    );
  }
  if (typeof body !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId} reply #${index + 1}: 'body' is required`,
    );
  }
  const editedAt = obj["edited_at"];
  if (editedAt !== undefined && typeof editedAt !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId} reply #${index + 1}: 'edited_at' must be a string`,
    );
  }
  const known = new Set<string>(REPLY_KEY_ORDER);
  const additionalKeys: Record<string, unknown> = {};
  let hasUnknown = false;
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) {
      additionalKeys[k] = obj[k];
      hasUnknown = true;
    }
  }
  const reply: Reply = {
    author,
    timestamp,
    body: unescapeContent(body),
  };
  if (editedAt !== undefined) reply.edited_at = editedAt;
  if (hasUnknown) reply.additionalKeys = additionalKeys;
  return reply;
}

function parseSuggestedEdit(raw: unknown, parentId: number): SuggestedEdit | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId}: 'suggested_edit' must be an object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const fromVal = obj["from"];
  const toVal = obj["to"];
  if (typeof fromVal !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId}: 'suggested_edit.from' is required`,
    );
  }
  if (typeof toVal !== "string") {
    throw new ForgemarkParseError(
      "schema",
      `Comment id=${parentId}: 'suggested_edit.to' is required`,
    );
  }
  // Defensive: surface unknown keys as a parse error rather than silently
  // dropping them. SuggestedEdit is small and stable.
  const known = new Set<string>(SUGGESTED_EDIT_KEY_ORDER);
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) {
      throw new ForgemarkParseError(
        "schema",
        `Comment id=${parentId}: 'suggested_edit' has unknown field '${k}'`,
      );
    }
  }
  return { from: unescapeContent(fromVal), to: unescapeContent(toVal) };
}

// Validate that:
//   - Comment ids are unique within the file.
//   - Every non-floating comment has matching open/close markers in the body.
//   - Every marker pair in the body has a matching YAML record.
function validateAgainstBody(body: string, comments: Comment[]) {
  const seen = new Map<number, Comment>();
  for (const c of comments) {
    if (seen.has(c.id)) {
      throw new ForgemarkParseError("schema", `Comment id ${c.id} appears more than once`);
    }
    seen.set(c.id, c);
  }

  const markers = findMarkers(body);
  const { pairs, unmatched } = pairMarkers(markers);
  if (unmatched.length > 0) {
    const m = unmatched[0];
    throw new ForgemarkParseError(
      "marker",
      `Unmatched ${m.type} marker for id ${m.id} at offset ${m.start}`,
    );
  }
  const pairById = new Map<number, true>();
  for (const p of pairs) {
    if (pairById.has(p.id)) {
      throw new ForgemarkParseError("marker", `Duplicate marker pair for id ${p.id} in body`);
    }
    pairById.set(p.id, true);
  }

  // marker → YAML record
  for (const p of pairs) {
    if (!seen.has(p.id)) {
      throw new ForgemarkParseError(
        "marker",
        `Marker pair for id ${p.id} present in body but no YAML record`,
      );
    }
  }
  // YAML record (non-floating) → marker
  for (const c of comments) {
    if (c.floating === true) continue;
    if (!pairById.has(c.id)) {
      throw new ForgemarkParseError(
        "marker",
        `Comment id ${c.id} has no inline marker pair in the body (and is not floating)`,
      );
    }
  }
}
