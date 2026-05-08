// serializeForgemarkFile — emit a Forgemark file from `{ body, comments }`.
// Symmetric with parser.ts; the round-trip parity test (Phase 3 hard
// gate) compares parse → serialize against the original bytes.
//
// Behaviour:
//   - body is emitted unchanged.
//   - When `comments.length === 0`, no trailing block is emitted (clean
//     files stay clean per the design).
//   - Otherwise, the trailing block is appended:
//
//       <body><trailing newline?>
//       <!-- forgemark-comments
//       <YAML list of comment records>
//       -->
//
//     Exactly one blank line separates the body from the open sentinel
//     (if the body doesn't already end in two newlines).

import { emitCommentsBlock } from "./yaml-emit";
import type { ParsedFile } from "./types";

export function serializeForgemarkFile(file: ParsedFile): string {
  if (file.comments.length === 0) return file.body;
  const yaml = emitCommentsBlock(file.comments);
  // Ensure exactly one blank line (i.e. two newlines) between body and the
  // open sentinel. If the body is empty, no leading newline.
  let prefix = file.body;
  if (prefix.length === 0) {
    prefix = "";
  } else if (prefix.endsWith("\n\n")) {
    // already has the right separator
  } else if (prefix.endsWith("\n")) {
    prefix = prefix + "\n";
  } else {
    prefix = prefix + "\n\n";
  }
  return prefix + "<!-- forgemark-comments\n" + yaml + "-->\n";
}
