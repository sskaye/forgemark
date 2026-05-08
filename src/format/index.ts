// Public API of the Forgemark format layer.
export { parseForgemarkFile, ForgemarkParseError, type ParseOptions } from "./parser";
export { serializeForgemarkFile } from "./serializer";
export { findMarkers, pairMarkers, anchorTextFor, type Marker, type MarkerPair } from "./markers";
export {
  openMarker,
  closeMarker,
  BLOCK_OPEN,
  BLOCK_CLOSE,
  COMMENT_KEY_ORDER,
  REPLY_KEY_ORDER,
  SUGGESTED_EDIT_KEY_ORDER,
  type Comment,
  type Reply,
  type SuggestedEdit,
  type ParsedFile,
} from "./types";
export { escapeContent, unescapeContent } from "./escape";
export { bodyWithAnchorSpans, bodyFromAnchorSpans } from "./markers-display";
export {
  nextCommentId,
  insertMarkersIntoBody,
  removeMarkersFromBody,
  replaceAnchoredText,
  stripAnchoredMarkers,
  contextSnippet,
} from "./compose";
export {
  getAnchorStatus,
  classifyAnchors,
  findCandidates,
  levenshtein,
  type AnchorStatus,
  type ReattachCandidate,
} from "./reattach";
export { cleanExport } from "./cleanExport";
