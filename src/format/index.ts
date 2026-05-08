// Public API of the Forgemark format layer.
export { parseForgemarkFile, ForgemarkParseError } from "./parser";
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
