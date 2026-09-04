// Public API of the Forgemark format layer.
export {
  parseForgemarkFile,
  recoverForgemarkFile,
  parseCommentsBlock,
  findStrayBlock,
  ForgemarkParseError,
  type ParseOptions,
  type RecoveryResult,
} from "./parser";
export {
  serializeForgemarkFile,
  ForgemarkSerializeError,
  type SerializeOptions,
} from "./serializer";
export { normalizeAnchorText, anchorTextMatches, stripMarkdownInline } from "./anchor-text";
export {
  locateAnchor,
  locateElement,
  applyPlacement,
  AnchorError,
  type Placement,
  type LocateOptions,
} from "./locate";
export { splitFrontmatter, type SplitBody } from "./frontmatter";
export {
  findMarkers,
  findMarkersMarkdown,
  findMarkersHtml,
  pairMarkers,
  anchorTextFor,
  type Marker,
  type MarkerPair,
} from "./markers";
export {
  openMarker,
  closeMarker,
  detectFormat,
  BLOCK_OPEN,
  BLOCK_CLOSE,
  DEFAULT_FORMAT,
  COMMENT_KEY_ORDER,
  REPLY_KEY_ORDER,
  SUGGESTED_EDIT_KEY_ORDER,
  type Comment,
  type DocFormat,
  type Reply,
  type SuggestedEdit,
  type ParsedFile,
} from "./types";
export {
  buildHtmlTextMap,
  textRangeToSource,
  rangeIsExact,
  runAt,
  type HtmlTextMap,
  type HtmlTextRun,
} from "./html/textmap";
export { escapeContent, unescapeContent } from "./escape";
export { bodyWithAnchorElements, coalesceAnchorMarkers } from "./markers-display";
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
