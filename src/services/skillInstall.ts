// Installing the agent skill where agents look for it.
//
// A skill is a folder with a SKILL.md, and each tool reads a known
// place under the home directory. The app carries the skill's source
// tree (the same files the .skill bundle zips) and can write it there,
// tell an installed copy's state by hashing it, and swap a new copy in
// without ever leaving the folder half-written. The Claude desktop app
// keeps skills per account instead, so for it the app writes the .skill
// file and hands it to Claude, which shows its own install prompt, the
// same as a double-click on the file.

import { appDataDir, homeDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { fetchSkillBundle } from "./skillDownload";
import {
  SKILL_MANIFEST,
  countsTowardTree,
  hashSkillTree,
  parseManifest,
  type SkillFile,
  type SkillManifest,
} from "./skillTree";

// The skill's files, as shipped: the source tree, not the zip, so an
// installed copy is the source byte for byte and nothing is unpacked.
const shippedByPath = import.meta.glob("../../assets/forgemark-skill/**", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

const PREFIX = "../../assets/forgemark-skill/";

export const SHIPPED_FILES: readonly SkillFile[] = Object.entries(shippedByPath)
  .map(([key, text]) => ({ path: key.slice(PREFIX.length), text }))
  .filter((f) => f.path !== ".DS_Store")
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const SHIPPED: SkillManifest = (() => {
  const text = shippedByPath[PREFIX + SKILL_MANIFEST];
  const parsed = text ? parseManifest(text) : null;
  if (!parsed)
    throw new Error("The skill bundle has no readable manifest; run npm run build:skill.");
  return parsed;
})();

export const SKILL_FOLDER_NAME = "forgemark";

export type TargetId = "claude-code" | "codex" | "claude-app" | "agents";

export type SkillTarget = {
  id: TargetId;
  name: string;
  // A folder target is written by the app; a handoff target gets the
  // .skill file opened in another app.
  kind: "folder" | "handoff";
  // The folder the skill is installed into, e.g. ~/.claude/skills/forgemark.
  folder: string;
  // What the row shows beneath the status, when the folder is worth
  // naming (the shared location is not obvious from the tool's name).
  shownPath?: string;
  // Shown once after a first install.
  afterInstall?: string;
};

export type SkillStatus =
  | { kind: "absent" }
  | { kind: "current"; version: string; sentAt?: string }
  | { kind: "outdated"; installed: string; sentAt?: string }
  | { kind: "foreign"; files: number; changed: string[] };

// The folders and detection roots, relative to the home directory.
// The same dot-folders on every platform; nothing uses AppData or XDG.
const CLAUDE_APP_LOCATIONS = [
  "/Applications/Claude.app",
  "~/Applications/Claude.app",
  "~/AppData/Local/AnthropicClaude",
];

function stripTrailingSeparators(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

function under(home: string, rel: string): string {
  return `${home}/${rel}`;
}

export type DetectOptions = { home?: string };

export async function detectTargets(opts: DetectOptions = {}): Promise<SkillTarget[]> {
  const home = stripTrailingSeparators(opts.home ?? (await homeDir()));
  const targets: SkillTarget[] = [];
  if (await exists(under(home, ".claude"))) {
    targets.push({
      id: "claude-code",
      name: "Claude Code",
      kind: "folder",
      folder: under(home, `.claude/skills/${SKILL_FOLDER_NAME}`),
      afterInstall: "new sessions pick it up",
    });
  }
  if (await exists(under(home, ".codex"))) {
    targets.push({
      id: "codex",
      name: "Codex",
      kind: "folder",
      folder: under(home, `.codex/skills/${SKILL_FOLDER_NAME}`),
    });
  }
  for (const loc of CLAUDE_APP_LOCATIONS) {
    const path = loc.startsWith("~/") ? under(home, loc.slice(2)) : loc;
    if (await exists(path)) {
      targets.push({
        id: "claude-app",
        name: "Claude app",
        kind: "handoff",
        folder: path,
        afterInstall: "Claude asks to install it",
      });
      break;
    }
  }
  targets.push({
    id: "agents",
    name: "Other tools",
    kind: "folder",
    folder: under(home, `.agents/skills/${SKILL_FOLDER_NAME}`),
    shownPath: "~/.agents/skills",
  });
  return targets;
}

// Every file under a folder, recursively, as relative forward-slash paths.
async function readTree(folder: string): Promise<SkillFile[]> {
  const out: SkillFile[] = [];
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readDir(dir)) {
      if (entry.name === ".DS_Store") continue;
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory) await walk(`${dir}/${entry.name}`, `${rel}/`);
      else if (entry.isFile)
        out.push({ path: rel, text: await readTextFile(`${dir}/${entry.name}`) });
    }
  };
  await walk(folder, "");
  return out;
}

// What the app remembers about a handoff: the version last handed over
// and when. Local to this machine, since the account is not visible.
const SENT_KEY = "forgemark.skillSent";

type Sent = { version: string; at: string };

function readSent(): Sent | null {
  try {
    const raw = window.localStorage.getItem(SENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Sent>;
    return typeof v.version === "string" && typeof v.at === "string"
      ? { version: v.version, at: v.at }
      : null;
  } catch {
    return null;
  }
}

function writeSent(sent: Sent) {
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    // Nothing to do: the row will simply not remember the date.
  }
}

export async function skillStatus(target: SkillTarget): Promise<SkillStatus> {
  if (target.kind === "handoff") {
    const sent = readSent();
    if (!sent) return { kind: "absent" };
    return sent.version === SHIPPED.version
      ? { kind: "current", version: sent.version, sentAt: sent.at }
      : { kind: "outdated", installed: sent.version, sentAt: sent.at };
  }
  if (!(await exists(target.folder))) return { kind: "absent" };
  const files = await readTree(target.folder);
  const tree = await hashSkillTree(files);
  if (tree === SHIPPED.tree) return { kind: "current", version: SHIPPED.version };
  const manifestText = files.find((f) => f.path === SKILL_MANIFEST)?.text;
  const manifest = manifestText ? parseManifest(manifestText) : null;
  // An intact older install: its manifest still describes its files.
  if (manifest && manifest.tree === tree) return { kind: "outdated", installed: manifest.version };
  // Anything else was not written by this app, or was changed since.
  const shipped = new Map(SHIPPED_FILES.map((f) => [f.path, f.text]));
  const changed = files
    .filter((f) => countsTowardTree(f.path) && shipped.get(f.path) !== f.text)
    .map((f) => f.path)
    .sort();
  return { kind: "foreign", files: files.length, changed };
}

async function writeTree(folder: string, files: readonly SkillFile[]) {
  await mkdir(folder, { recursive: true });
  const made = new Set<string>();
  for (const f of files) {
    const slash = f.path.lastIndexOf("/");
    if (slash >= 0) {
      const dir = `${folder}/${f.path.slice(0, slash)}`;
      if (!made.has(dir)) {
        await mkdir(dir, { recursive: true });
        made.add(dir);
      }
    }
    await writeTextFile(`${folder}/${f.path}`, f.text);
  }
}

async function removeIfPresent(path: string) {
  if (await exists(path)) await remove(path, { recursive: true });
}

// Write the shipped skill into the target's folder: a fresh copy is
// written beside it, read back and checked against the shipped hash,
// and only then swapped into place. A failure anywhere leaves whatever
// was installed exactly as it was.
export async function installSkill(target: SkillTarget): Promise<SkillStatus> {
  if (target.kind === "handoff") return handOffSkill(target);
  const staging = `${target.folder}.installing`;
  const previous = `${target.folder}.previous`;
  await removeIfPresent(staging);
  try {
    await writeTree(staging, SHIPPED_FILES);
    const written = await hashSkillTree(await readTree(staging));
    if (written !== SHIPPED.tree) {
      throw new Error("The copy written does not read back as the skill this app ships.");
    }
    await removeIfPresent(previous);
    const had = await exists(target.folder);
    if (had) await rename(target.folder, previous);
    try {
      await rename(staging, target.folder);
    } catch (err) {
      if (had) await rename(previous, target.folder);
      throw err;
    }
    await removeIfPresent(previous);
  } catch (err) {
    await removeIfPresent(staging);
    throw err;
  }
  return { kind: "current", version: SHIPPED.version };
}

// Where the .skill file is written for the hand-off.
export async function handoffFilePath(): Promise<string> {
  const dir = stripTrailingSeparators(await appDataDir());
  return `${dir}/forgemark-skill.skill`;
}

// The application name the opener passes to the system: `open -a Claude`
// on macOS, the registered handler elsewhere.
export const CLAUDE_APP_NAME = "Claude";

async function handOffSkill(target: SkillTarget): Promise<SkillStatus> {
  const file = await handoffFilePath();
  const dir = file.slice(0, file.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(file, await fetchSkillBundle());
  await openPath(file, target.id === "claude-app" ? CLAUDE_APP_NAME : undefined);
  const at = new Date().toISOString();
  writeSent({ version: SHIPPED.version, at });
  return { kind: "current", version: SHIPPED.version, sentAt: at };
}

// The one-line notice at launch: whether any folder install is behind
// the skill this app ships, remembered as dismissed per app version.
const NOTICE_KEY = "forgemark.skillNoticeDismissed";

export function noticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === SHIPPED.version;
  } catch {
    return false;
  }
}

export function dismissNotice() {
  try {
    window.localStorage.setItem(NOTICE_KEY, SHIPPED.version);
  } catch {
    // Nothing to do.
  }
}

export async function anyInstallOutdated(): Promise<boolean> {
  const targets = await detectTargets();
  for (const t of targets) {
    if (t.kind !== "folder") continue;
    const s = await skillStatus(t);
    if (s.kind === "outdated") return true;
  }
  return false;
}
