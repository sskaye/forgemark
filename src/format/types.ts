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
  // What the marker pair encloses. Absent means a run of text, which is
  // the overwhelming majority and so stays unwritten. "element" means the
  // markers wrap a whole block — a figure, chart, or table — which is the
  // only way to comment on something that has no text to select, and the
  // thing reviewers most want to point at in a generated report.
  anchor_kind?: "element";
  // A CSS selector that identifies the anchored element, written when
  // the report gives it a stable id. Tried before any text matching when
  // reattaching, which turns recovery after a regenerated report from
  // probabilistic into exact. Purely a hint: a stale selector costs
  // nothing because text matching still runs.
  anchor_selector?: string;
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

// Which document language the body is written in. The storage format is
// identical in both — `<!-- fmc:N -->` markers and a trailing
// `<!-- forgemark-comments -->` block are valid HTML *and* valid
// Markdown — but the rules for where a marker may legally appear differ,
// so marker scanning is parameterised on this. Everything else in the
// format layer (serializer, YAML emitter, splice helpers, clean export)
// is language-blind and takes no `format` argument.
export type DocFormat = "markdown" | "html";

export const DEFAULT_FORMAT: DocFormat = "markdown";

// Extension → format. Anything unrecognised is treated as Markdown,
// which is both the historical behaviour and the safer default: the
// Markdown scanner never invents anchors, it only misses them.
export function detectFormat(pathOrName: string | null | undefined): DocFormat {
  if (!pathOrName) return DEFAULT_FORMAT;
  return /\.(html?|xhtml)$/i.test(pathOrName) ? "html" : DEFAULT_FORMAT;
}

// Field order canonicalised by the serializer. Listed here so tests can
// reference the same source of truth.
export const COMMENT_KEY_ORDER = [
  "id",
  "floating",
  "anchor_text",
  "anchor_kind",
  "anchor_selector",
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
// Either marker of any id. Global; safe to share because `matchAll` and
// `replace` clone it before use.
export const MARKER_ANY_RE_G = /<!--\s*\/?fmc:\d+\s*-->/g;
export const MARKER_CLOSE_RE_G = /<!--\s*\/fmc:(\d+)\s*-->/g;

export function openMarker(id: number): string {
  return `<!-- fmc:${id} -->`;
}

export function closeMarker(id: number): string {
  return `<!-- /fmc:${id} -->`;
}
