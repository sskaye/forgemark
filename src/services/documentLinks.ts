// Where a link or an image in a document points, relative to the file
// it is in. A document under review lives in a folder, and its links and
// images are written relative to that folder, as on GitHub; the editor
// and the report frame have no folder of their own, so every relative
// reference has to be resolved here first.

import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizeExternalUrl } from "./externalLinks";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DOCUMENT_EXTENSIONS = /\.(md|markdown|html|htm)$/i;

// The folder a file is in, or null for a file that has no path yet.
export function dirOf(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (i < 0) return null;
  return filePath.slice(0, i) || "/";
}

// A reference that names something on disk relative to the document,
// as opposed to an address, a fragment, or inline data.
export function isRelativeRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return false;
  return !SCHEME.test(trimmed);
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// `ref` resolved against `baseDir`, with `.` and `..` folded. A
// reference starting with `/` is an absolute path already.
export function resolvePath(baseDir: string, ref: string): string {
  const clean = decode(ref.split("#")[0].split("?")[0]);
  if (clean.startsWith("/")) return clean;
  const sep = baseDir.includes("\\") && !baseDir.includes("/") ? "\\" : "/";
  const parts = baseDir.split(/[\\/]/);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const joined = parts.join(sep);
  return joined === "" ? sep : joined;
}

// A URL the webview may load for a file on disk.
export function assetUrl(path: string): string {
  return convertFileSrc(path);
}

// The display URL for an image or other resource reference: a relative
// one becomes an asset URL against the document's folder, anything else
// is returned as written.
export function resolveResource(baseDir: string | null, ref: string): string {
  if (!baseDir || !isRelativeRef(ref)) return ref;
  return assetUrl(resolvePath(baseDir, ref));
}

export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "fragment"; id: string }
  | { kind: "document"; path: string; fragment: string | null }
  | { kind: "file"; path: string }
  | { kind: "none" };

// What clicking a link should do.
export function classifyLink(href: string | null | undefined, baseDir: string | null): LinkTarget {
  const trimmed = href?.trim() ?? "";
  if (!trimmed) return { kind: "none" };
  if (trimmed.startsWith("#")) return { kind: "fragment", id: decode(trimmed.slice(1)) };
  if (SCHEME.test(trimmed) || trimmed.startsWith("//")) {
    const url = normalizeExternalUrl(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    return url ? { kind: "external", url } : { kind: "none" };
  }
  const hash = trimmed.indexOf("#");
  const fragment = hash >= 0 ? decode(trimmed.slice(hash + 1)) : null;
  const pathPart = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  if (!pathPart) return { kind: "none" };
  if (!pathPart.startsWith("/") && !baseDir) return { kind: "none" };
  const path = resolvePath(baseDir ?? "/", pathPart);
  return DOCUMENT_EXTENSIONS.test(path)
    ? { kind: "document", path, fragment }
    : { kind: "file", path };
}

// GitHub's heading anchor: lower case, punctuation dropped, spaces to
// hyphens; a repeat gets -1, -2, … The counter belongs to one document.
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}
