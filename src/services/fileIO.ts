// Tauri file I/O wrappers.
//
// Phase 2 surface:
//   - openMarkdownFile(): show the open dialog, return the file's text + path
//     + read-only state, or null if the user cancelled.
//   - saveMarkdownFile(path, text): write the file. Returns void on success.
//   - basename(path): extract the file's display name.
//
// All Tauri-flavoured calls go through this module. Tests stub it.

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, stat } from "@tauri-apps/plugin-fs";

export type OpenedFile = {
  path: string;
  fileName: string;
  text: string;
  readOnly: boolean;
};

// Open a markdown file. Returns null if the user cancelled.
// Throws if the chosen file can't be read (e.g. moved between dialog
// pick and read).
//
// Kept for callers that want exactly one document; multi-select lives in
// `openMarkdownFiles` below.
export async function openMarkdownFile(): Promise<OpenedFile | null> {
  const [first = null] = await openMarkdownFiles({ multiple: false });
  return first;
}

// Open one or more markdown files. Each becomes its own tab.
//
// Reads are sequential rather than concurrent: a fistful of parallel
// file reads buys nothing perceptible here and makes the failure story
// worse. Files that can't be read are skipped and reported, so one bad
// path out of five doesn't sink the other four.
export async function openMarkdownFiles(opts: { multiple?: boolean } = {}): Promise<OpenedFile[]> {
  const selected = await open({
    multiple: opts.multiple ?? true,
    directory: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (selected === null) return [];
  const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean);
  const opened: OpenedFile[] = [];
  const failures: string[] = [];
  for (const path of paths) {
    try {
      opened.push(await readMarkdownFile(path));
    } catch (err) {
      failures.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (opened.length === 0 && failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return opened;
}

// Read a known path. Surfaces a helpful error if the path is missing or
// is a directory (defensive — the dialog filter should have caught this,
// but tests cover the case).
export async function readMarkdownFile(path: string): Promise<OpenedFile> {
  let stats;
  try {
    stats = await stat(path);
  } catch (err) {
    throw new Error(`File no longer exists at ${path}: ${err}`);
  }
  if (stats.isDirectory) {
    throw new Error(`Path is a directory, not a markdown file: ${path}`);
  }
  if (!isMarkdownPath(path)) {
    throw new Error(`Not a markdown file: ${path}`);
  }
  const text = await readTextFile(path);
  return {
    path,
    fileName: basename(path),
    text,
    readOnly: stats.readonly === true,
  };
}

// Save text to the given path. If `path` is null (e.g. an Untitled buffer),
// prompts for a destination via a save dialog and returns the chosen path.
export async function saveMarkdownFile(path: string | null, text: string): Promise<string | null> {
  let target = path;
  if (!target) {
    const chosen = await save({
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      defaultPath: "Untitled.md",
    });
    if (!chosen) return null; // user cancelled
    target = chosen;
  }
  await writeTextFile(target, text);
  return target;
}

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
