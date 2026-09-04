// Tauri file I/O wrappers.
//
// Surface:
//   - openDocuments(): show the open dialog, return each file's text +
//     path + read-only state.
//   - readDocument(path): read a known path.
//   - saveDocument(path, text): write the file.
//   - basename(path): extract the file's display name.
//
// Forgemark opens Markdown and HTML. The two are the same product — the
// storage format is identical, and a workspace holds a mix of both — so
// there is one dialog with one filter list rather than a mode switch.
//
// All Tauri-flavoured calls go through this module. Tests stub it.

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, stat, lstat, rename, remove } from "@tauri-apps/plugin-fs";
import { detectFormat } from "../format/types";
import type { DocFormat } from "../format/types";

// The one place the set of openable extensions is written down.
const MARKDOWN_EXTENSIONS = ["md", "markdown"];
const HTML_EXTENSIONS = ["html", "htm", "xhtml"];

const OPEN_FILTERS = [
  { name: "Documents", extensions: [...MARKDOWN_EXTENSIONS, ...HTML_EXTENSIONS] },
  { name: "Markdown", extensions: MARKDOWN_EXTENSIONS },
  { name: "HTML", extensions: HTML_EXTENSIONS },
];

export type OpenedFile = {
  path: string;
  fileName: string;
  text: string;
  readOnly: boolean;
  // Decided here, from the extension, so every caller agrees and the
  // decision is made exactly once per open.
  format: DocFormat;
};

// Open one or more documents. Each becomes its own tab.
//
// Reads are sequential rather than concurrent: a fistful of parallel
// file reads buys nothing perceptible here and makes the failure story
// worse. Files that can't be read are skipped and reported, so one bad
// path out of five doesn't sink the other four.
export async function openDocuments(opts: { multiple?: boolean } = {}): Promise<OpenedFile[]> {
  const selected = await open({
    multiple: opts.multiple ?? true,
    directory: false,
    filters: OPEN_FILTERS,
  });
  if (selected === null) return [];
  const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean);
  const opened: OpenedFile[] = [];
  const failures: string[] = [];
  for (const path of paths) {
    try {
      opened.push(await readDocument(path));
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
export async function readDocument(path: string): Promise<OpenedFile> {
  let stats;
  try {
    stats = await stat(path);
  } catch (err) {
    throw new Error(`File no longer exists at ${path}: ${err}`);
  }
  if (stats.isDirectory) {
    throw new Error(`Path is a directory, not a markdown file: ${path}`);
  }
  if (!isSupportedPath(path)) {
    throw new Error(`Not a Markdown or HTML file: ${path}`);
  }
  const text = await readTextFile(path);
  return {
    path,
    fileName: basename(path),
    text,
    readOnly: stats.readonly === true,
    format: detectFormat(path),
  };
}

// Save text to the given path. If `path` is null (e.g. an Untitled buffer),
// prompts for a destination via a save dialog and returns the chosen path.
//
// `format` picks the dialog's default extension. An Untitled buffer is
// always Markdown — there is no way to author a report in Forgemark —
// so HTML only reaches this branch via Save As on an opened report.
export async function saveDocument(
  path: string | null,
  text: string,
  format: DocFormat = "markdown",
  // The name the dialog proposes when it has to ask. Defaults to
  // Untitled with the format's extension.
  defaultName?: string,
): Promise<string | null> {
  let target = path;
  if (!target) {
    const chosen = await save({
      filters:
        format === "html"
          ? [{ name: "HTML", extensions: HTML_EXTENSIONS }]
          : [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
      defaultPath: defaultName ?? (format === "html" ? "Untitled.html" : "Untitled.md"),
    });
    if (!chosen) return null; // user cancelled
    target = chosen;
  }
  await writeAtomically(target, text);
  return target;
}

// Write beside the target and rename into place, so a reader that opens
// the file mid-write — the CLI's lint, an agent's watcher, a sync
// client — sees the old bytes or the new ones, never a truncated file.
// The rename is also the single event the directory watcher was built
// around. A symlink is written in place instead: renaming over it would
// replace the link with a plain file.
async function writeAtomically(target: string, text: string): Promise<void> {
  let symlink = false;
  try {
    symlink = (await lstat(target)).isSymlink === true;
  } catch {
    // The file doesn't exist yet; a plain rename creates it.
  }
  if (symlink) {
    await writeTextFile(target, text);
    return;
  }
  const sep = target.lastIndexOf("\\") > target.lastIndexOf("/") ? "\\" : "/";
  const idx = target.lastIndexOf(sep);
  const dir = idx >= 0 ? target.slice(0, idx + 1) : "";
  const name = idx >= 0 ? target.slice(idx + 1) : target;
  const tmp = `${dir}.${name}.${Date.now().toString(36)}.tmp`;
  await writeTextFile(tmp, text);
  try {
    await rename(tmp, target);
  } catch (err) {
    try {
      await remove(tmp);
    } catch {
      // The rename error is the one worth reporting.
    }
    throw err;
  }
}

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function isHtmlPath(path: string): boolean {
  return /\.(html?|xhtml)$/i.test(path);
}

// Whether Forgemark will open this path at all.
export function isSupportedPath(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path);
}
