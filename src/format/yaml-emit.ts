// Schema-aware deterministic YAML emitter for Forgemark comment records.
//
// Why a custom emitter rather than the `yaml` library's stringify:
// libraries normally optimise for "pretty" or "compact" output, neither
// of which guarantees byte-identity across versions. We need bytewise
// determinism so the round-trip parity test (Phase 3 hard gate) is
// stable. The schema is small and the emitter rules are few, so a custom
// emitter is simpler than configuring and pinning a third-party serializer.
//
// Quoting policy:
//   - Numbers and booleans: bare.
//   - Multi-line strings: block-literal `|`.
//   - Single-line strings: bare iff `isPlainSafe(s)` returns true (the
//     string is unambiguously a YAML "plain scalar"); otherwise double-quoted.
//
// Indentation: 2 spaces. List items use the standard `- ` prefix and
// continue at +2 indent.

import { escapeContent } from "./escape";
import {
  COMMENT_KEY_ORDER,
  REPLY_KEY_ORDER,
  SUGGESTED_EDIT_KEY_ORDER,
  type Comment,
  type Reply,
  type SuggestedEdit,
} from "./types";

const INDENT = "  ";

// Bare-safe plain scalar: alphanumerics, dashes, dots, underscores. We
// also allow the ISO 8601 datetime shape (e.g. 2026-05-07T14:32:00Z)
// since it round-trips cleanly through the `yaml` parser back into a
// JS string in our schema.
//
// To stay deterministic, anything outside this whitelist is double-quoted.
function isPlainSafe(s: string): boolean {
  if (s.length === 0) return false;
  // YAML reserved values — quote them so they round-trip as strings.
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return false;
  // ISO 8601 UTC timestamp — bare is fine and human-friendly.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return true;
  // Integer or decimal — would parse as a number; quote.
  if (/^-?\d+(\.\d+)?$/.test(s)) return false;
  // Identifier-like: starts with letter, only alnum + safe puncts.
  // No `:` here — that's the YAML key/value separator and would confuse
  // the parser if it appeared bare.
  return /^[A-Za-z][A-Za-z0-9._/-]*$/.test(s);
}

function emitString(s: string): string {
  if (s.includes("\n")) {
    // Use block-literal. We escape user content first so `-->` etc. are safe.
    const escaped = escapeContent(s);
    return emitBlockLiteral(escaped);
  }
  if (isPlainSafe(s)) return s;
  // Double-quoted scalar with escapes.
  return '"' + escapeForDoubleQuote(escapeContent(s)) + '"';
}

function escapeForDoubleQuote(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\b") out += "\\b";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else out += ch;
  }
  return out;
}

// Block-literal `|` style. Always uses chomp-clip (default) — assumes the
// final newline is intentional. For Forgemark bodies this is the natural
// choice.
function emitBlockLiteral(content: string): string {
  // YAML block-literal:
  //
  //   key: |
  //     line one
  //     line two
  //
  // The string passed in here is the raw user content (newlines and all).
  // It is rendered after the `|`, indented by `INDENT` more than the key
  // line. Trailing newlines are preserved by default chomping.
  return content; // serializer adds the `|` prefix and indents
}

// Emit a Reply object. `indent` is the indentation level for keys (the
// hyphen prefix lives one level shallower).
function emitReply(reply: Reply, indent: string): string[] {
  const out: string[] = [];
  const known = new Set<string>(REPLY_KEY_ORDER);
  // Required: author, timestamp, body. edited_at optional.
  for (const key of REPLY_KEY_ORDER) {
    const value = reply[key];
    if (value === undefined) continue;
    out.push(...emitKeyValue(key, value, indent));
  }
  if (reply.additionalKeys) {
    for (const [k, v] of Object.entries(reply.additionalKeys)) {
      if (known.has(k)) continue;
      out.push(...emitKeyValue(k, v, indent));
    }
  }
  return out;
}

function emitSuggestedEdit(suggested: SuggestedEdit, indent: string): string[] {
  const out: string[] = [];
  for (const key of SUGGESTED_EDIT_KEY_ORDER) {
    out.push(...emitKeyValue(key, suggested[key], indent));
  }
  return out;
}

function emitKeyValue(key: string, value: unknown, indent: string): string[] {
  if (value === undefined) return [];
  if (value === null) return [`${indent}${key}: null`];
  if (typeof value === "boolean") return [`${indent}${key}: ${value}`];
  if (typeof value === "number") return [`${indent}${key}: ${value}`];
  if (typeof value === "string") {
    if (value.includes("\n")) {
      // Block-literal
      const escaped = escapeContent(value);
      const lines = escaped.split("\n");
      const result = [`${indent}${key}: |`];
      // Strip a trailing blank line — block-literal adds an implicit newline.
      const lineSlice = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
      for (const ln of lineSlice) result.push(`${indent}${INDENT}${ln}`);
      return result;
    }
    return [`${indent}${key}: ${emitString(value)}`];
  }
  if (Array.isArray(value)) {
    // Generic array: emit each item under a `- ` prefix. Used for unknown
    // fields that happen to be arrays. (Replies are emitted via the
    // dedicated path because they have a fixed key order.)
    if (value.length === 0) return [`${indent}${key}: []`];
    const result = [`${indent}${key}:`];
    for (const item of value) {
      const sub = stringifyGeneric(item, indent + INDENT);
      result.push(`${indent}${INDENT}- ${sub.shift()?.trimStart() ?? ""}`);
      for (const more of sub) result.push(more);
    }
    return result;
  }
  if (typeof value === "object") {
    const result = [`${indent}${key}:`];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result.push(...emitKeyValue(k, v, indent + INDENT));
    }
    return result;
  }
  // Fallback (symbols, functions). Stringify defensively.
  return [`${indent}${key}: ${String(value)}`];
}

// stringifyGeneric mirrors emitKeyValue for unknown structures.
function stringifyGeneric(value: unknown, indent: string): string[] {
  if (value === null || value === undefined) return [`${indent}null`];
  if (typeof value === "boolean" || typeof value === "number") {
    return [`${indent}${value}`];
  }
  if (typeof value === "string") {
    if (value.includes("\n")) {
      const escaped = escapeContent(value);
      const lines = escaped.split("\n");
      const result = [`${indent}|`];
      const lineSlice = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
      for (const ln of lineSlice) result.push(`${indent}${INDENT}${ln}`);
      return result;
    }
    return [`${indent}${emitString(value)}`];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    const result: string[] = [];
    for (const item of value) {
      const sub = stringifyGeneric(item, indent + INDENT);
      result.push(`${indent}- ${sub.shift()?.trimStart() ?? ""}`);
      for (const more of sub) result.push(more);
    }
    return result;
  }
  if (typeof value === "object") {
    const result: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result.push(...emitKeyValue(k, v, indent));
    }
    return result;
  }
  return [`${indent}${String(value)}`];
}

// emitComment produces the lines for a single Comment record, starting
// with `- id: N` and continuing with the rest of the keys at `+ INDENT`.
export function emitComment(comment: Comment): string[] {
  const itemIndent = ""; // for the `-` prefix line
  const childIndent = INDENT; // body of the comment under the prefix
  const known = new Set<string>(COMMENT_KEY_ORDER);
  const out: string[] = [];
  let firstKeyEmitted = false;

  for (const key of COMMENT_KEY_ORDER) {
    const value = (comment as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === "replies") {
      const replies = value as Reply[];
      if (replies.length === 0) continue;
      pushKeyHeader(out, "replies", childIndent, itemIndent, firstKeyEmitted);
      firstKeyEmitted = true;
      for (const reply of replies) {
        const replyLines = emitReply(reply, childIndent + INDENT + INDENT);
        const first = replyLines.shift() ?? "";
        out.push(`${childIndent}${INDENT}- ${first.trimStart()}`);
        for (const ln of replyLines) out.push(ln);
      }
      continue;
    }
    if (key === "suggested_edit") {
      pushKeyHeader(out, "suggested_edit", childIndent, itemIndent, firstKeyEmitted);
      firstKeyEmitted = true;
      out.push(...emitSuggestedEdit(value as SuggestedEdit, childIndent + INDENT));
      continue;
    }
    // Scalar / single-line value at the comment level.
    const lines = emitKeyValue(key, value, firstKeyEmitted ? childIndent : "");
    if (!firstKeyEmitted) {
      // Replace the empty indent with the `- ` list marker prefix.
      lines[0] = "- " + lines[0];
    }
    for (const ln of lines) out.push(ln);
    firstKeyEmitted = true;
  }

  // Unknown fields (forward compat) emitted in their original key order.
  if (comment.additionalKeys) {
    for (const [k, v] of Object.entries(comment.additionalKeys)) {
      if (known.has(k)) continue;
      const lines = emitKeyValue(k, v, firstKeyEmitted ? childIndent : "");
      if (!firstKeyEmitted) {
        lines[0] = "- " + lines[0];
      }
      for (const ln of lines) out.push(ln);
      firstKeyEmitted = true;
    }
  }

  return out;
}

function pushKeyHeader(
  out: string[],
  key: string,
  childIndent: string,
  itemIndent: string,
  firstKeyEmitted: boolean,
) {
  if (firstKeyEmitted) {
    out.push(`${childIndent}${key}:`);
  } else {
    out.push(`${itemIndent}- ${key}:`);
  }
}

// Top-level: emit a list of comments as the YAML body of the comments block.
export function emitCommentsBlock(comments: Comment[]): string {
  if (comments.length === 0) return "";
  const lines: string[] = [];
  for (const c of comments) {
    lines.push(...emitComment(c));
  }
  return lines.join("\n") + "\n";
}
