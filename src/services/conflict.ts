// External-edit conflict detection (Phase 9 infrastructure; Phase 10
// reuses to drive the conflict surfaces).
//
// The detection pipeline has two stages:
//
//   1. mtime fast-path — if the file's mtime matches the value we
//      observed at our last read or save, the file hasn't changed and
//      we skip the hash. This is conservative: a touch-save with no
//      content change is harmless even if it falls through to step 2.
//
//   2. content hash — when mtime *has* changed, compute a hash of the
//      newly-read text and compare against the hash of the bytes we
//      last loaded or wrote. Hashes match → false positive (rare —
//      mtime updated with no content change), don't fire. Hashes
//      differ → real external edit, fire.
//
// The hash function is the Web Crypto SHA-256 wrapper (available in
// jsdom/Node 19+/browsers). For tests, Node's `crypto.subtle` is a
// drop-in equivalent. We don't need cryptographic strength — Forgemark
// only uses the hash to compare two snapshots of the same file, so a
// fast non-cryptographic hash would suffice. Picking SHA-256 keeps the
// dependency surface to zero (it's built into the platform).

export type FileFingerprint = {
  mtimeMs: number | null;
  hash: string;
};

// Compare two fingerprints. Returns:
//   - "unchanged" when mtime matches (skip the hash, fast path)
//   - "unchanged" when mtime differs but hashes match
//   - "changed" when both mtime and hash differ
export function compareFingerprints(
  prev: FileFingerprint,
  next: FileFingerprint,
): "changed" | "unchanged" {
  if (prev.mtimeMs != null && next.mtimeMs != null && prev.mtimeMs === next.mtimeMs) {
    return "unchanged";
  }
  if (prev.hash === next.hash) return "unchanged";
  return "changed";
}

export async function fingerprint(text: string, mtimeMs: number | null): Promise<FileFingerprint> {
  return { mtimeMs, hash: await sha256(text) };
}

// Synchronous fingerprint — for unit tests where we control mtime, and
// for the in-memory comparison path that doesn't need crypto. Tests
// pass a known hash directly rather than computing one.
export function fingerprintSync(
  _text: string,
  mtimeMs: number | null,
  hash: string,
): FileFingerprint {
  return { mtimeMs, hash };
}

async function sha256(text: string): Promise<string> {
  // crypto.subtle is available in browsers and in Node 19+. jsdom
  // doesn't currently expose crypto.subtle, but we don't call this
  // path in jsdom — tests use a fake fingerprint via fingerprintSync.
  if (
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof crypto.subtle.digest === "function"
  ) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bufferToHex(digest);
  }
  // Fallback for jsdom: a non-cryptographic FNV-1a so tests can still
  // exercise the comparison logic deterministically.
  return fnv1a(text);
}

function bufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}
