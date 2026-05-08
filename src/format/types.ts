// Comment-record schema. Mirrors the proposal's Storage Format / Schema
// reference. The `[key: string]: unknown` index signature plus
// `additionalKeys` pattern preserves unknown fields on round-trip per the
// Forward-compatibility paragraph.

export type Reply = {
  author: string;
  timestamp: string;
  edited_at?: string;
  body: string;
  // Unknown fields preserved from disk; the serializer emits known fields
  // first in canonical order, then unknowns in their original key order.
  additionalKeys?: Record<string, unknown>;
};

export type SuggestedEdit = {
  from: string;
  to: string;
};

export type Comment = {
  id: number;
  // anchor_text is required unless `floating: true`. Validation enforces.
  anchor_text?: string;
  context_before?: string;
  context_after?: string;
  author: string;
  timestamp: string;
  edited_at?: string;
  resolved: boolean;
  body?: string; // required for plain comments; optional with suggested_edit
  replies?: Reply[];
  suggested_edit?: SuggestedEdit;
  floating?: boolean;
  // Forward-compat: unknown top-level fields preserved across round-trip.
  additionalKeys?: Record<string, unknown>;
};

export type ParsedFile = {
  body: string;
  comments: Comment[];
};

// Field order canonicalised by the serializer. Listed here so tests can
// reference the same source of truth.
export const COMMENT_KEY_ORDER = [
  "id",
  "floating",
  "anchor_text",
  "context_before",
  "context_after",
  "author",
  "timestamp",
  "edited_at",
  "resolved",
  "body",
  "suggested_edit",
  "replies",
] as const;

export const REPLY_KEY_ORDER = ["author", "timestamp", "edited_at", "body"] as const;

export const SUGGESTED_EDIT_KEY_ORDER = ["from", "to"] as const;

// Block delimiters. Exact strings — both must appear on their own line.
export const BLOCK_OPEN = "<!-- forgemark-comments";
export const BLOCK_CLOSE = "-->";

// Inline marker patterns.
export const MARKER_OPEN_RE = /<!--\s*fmc:(\d+)\s*-->/;
export const MARKER_CLOSE_RE = /<!--\s*\/fmc:(\d+)\s*-->/;
export const MARKER_OPEN_RE_G = /<!--\s*fmc:(\d+)\s*-->/g;
export const MARKER_CLOSE_RE_G = /<!--\s*\/fmc:(\d+)\s*-->/g;

export function openMarker(id: number): string {
  return `<!-- fmc:${id} -->`;
}

export function closeMarker(id: number): string {
  return `<!-- /fmc:${id} -->`;
}
