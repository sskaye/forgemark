// The identity of a skill folder: one hash over every file in it.
//
// The app judges an installed copy of the skill by hashing its files the
// same way the build does, so the two must agree byte for byte. The
// rule, kept deliberately small so `scripts/build-skill.mjs` can repeat
// it in plain Node: take every file except the manifest itself, sorted by
// its forward-slash relative path in code-unit order; for each, one line
// of the path, a newline, the file's SHA-256 in lowercase hex, a newline;
// hash the UTF-8 of those lines. A test compares the two implementations
// over the real source tree.

export const SKILL_MANIFEST = "forgemark-skill.json";

export type SkillFile = { path: string; text: string };

export type SkillManifest = { version: string; tree: string };

const encoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isManifestPath(path: string): boolean {
  return path === SKILL_MANIFEST;
}

// Files the hash ignores: the manifest (it holds the hash) and Finder's
// droppings, which an installed folder may pick up.
export function countsTowardTree(path: string): boolean {
  if (isManifestPath(path)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name !== ".DS_Store";
}

export async function hashSkillTree(files: readonly SkillFile[]): Promise<string> {
  const sorted = files
    .filter((f) => countsTowardTree(f.path))
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let lines = "";
  for (const f of sorted) {
    lines += `${f.path}\n${await sha256Hex(encoder.encode(f.text))}\n`;
  }
  return sha256Hex(encoder.encode(lines));
}

export function parseManifest(text: string): SkillManifest | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object") return null;
    const { version, tree } = value as Record<string, unknown>;
    if (typeof version !== "string" || typeof tree !== "string") return null;
    return { version, tree };
  } catch {
    return null;
  }
}
