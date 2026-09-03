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
import { findStrayBlock, parseCommentsBlock } from "./parser";
import type { ParsedFile } from "./types";

// Thrown when the file that would be written could not be read back.
// Every case in the field so far was one record hiding every comment in
// the file, so the write is refused rather than attempted.
export class ForgemarkSerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForgemarkSerializeError";
  }
}

export type SerializeOptions = {
  // Check that the output can be read back before returning it. On by
  // default — anything bound for disk must pass. Display-only callers
  // (the Source view renders the would-be file on every keystroke) turn
  // it off, since a failure there should not take the editor down.
  validate?: boolean;
};

export function serializeForgemarkFile(file: ParsedFile, opts: SerializeOptions = {}): string {
  if (file.comments.length === 0) return file.body;
  const yaml = emitCommentsBlock(file.comments);
  if (opts.validate !== false) assertReadable(file, yaml);
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

// Two ways a written file can lose every comment, both caught here:
//
//   1. The body already holds a `<!-- forgemark-comments` line — the
//      leftover of a block that could not be read on open. Appending a
//      second block would leave two, with colliding ids, and the app
//      would read only the last. The file is left alone so the existing
//      block can be repaired.
//   2. The emitted YAML does not parse back to the same records. The
//      emitter is deterministic, so this is a guard against an emitter
//      bug — exactly the class that once wrote an unreadable block
//      scalar — rather than something expected to fire.
function assertReadable(file: ParsedFile, yaml: string): void {
  const stray = findStrayBlock(file.body);
  if (stray) {
    throw new ForgemarkSerializeError(
      `The document already contains a comments block at line ${stray.line} that could not be read. ` +
        `Writing a second block would hide every comment, so the file was not written. ` +
        `Repair the existing block first.`,
    );
  }
  let back;
  try {
    back = parseCommentsBlock(yaml);
  } catch (err) {
    throw new ForgemarkSerializeError(
      `Refusing to write a comments block that cannot be read back: ${(err as Error).message}`,
    );
  }
  const want = file.comments.map((c) => c.id).join(",");
  const got = back.map((c) => c.id).join(",");
  if (want !== got) {
    throw new ForgemarkSerializeError(
      `Refusing to write a comments block that reads back differently (ids ${want} became ${got}).`,
    );
  }
}
