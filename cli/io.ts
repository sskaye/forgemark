// Disk and clock, kept out of the operations so those stay testable.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { dirname, basename, join } from "node:path";
import { detectFormat, type DocFormat } from "../src/format/types";

export type Source = { path: string; text: string; format: DocFormat };

export function readSource(path: string): Source {
  if (!existsSync(path)) throw new IoError(`No such file: ${path}`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new IoError(`Couldn't read ${path}: ${(err as Error).message}`);
  }
  return { path, text, format: detectFormat(path) };
}

// Write through a temporary file in the same directory and rename it
// into place. A reader — the Forgemark app, which watches the directory
// — sees either the old file or the new one, never a half-written one.
// The rename targets the real file, so a symlinked document keeps its
// link rather than being replaced by a plain file.
export function writeAtomic(path: string, text: string): void {
  try {
    path = realpathSync(path);
  } catch {
    // Not there yet; the rename creates it.
  }
  const tmp = join(dirname(path), `.${basename(path)}.forgemark-${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // The original error is the one worth reporting.
    }
    throw new IoError(`Couldn't write ${path}: ${(err as Error).message}`);
  }
}

export function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch (err) {
    throw new IoError(`Couldn't read stdin: ${(err as Error).message}`);
  }
}

// ISO 8601 UTC to the second, the shape the format specifies.
export function nowIso(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class IoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IoError";
  }
}
