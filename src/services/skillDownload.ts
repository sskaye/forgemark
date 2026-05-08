// Skill bundle downloads (Phase 12).
//
// The Forgemark app ships two byte-identical skill artifacts: a
// `.skill` for Claude Code and a `.zip` for Codex CLI. The Settings →
// AI Participation panel exposes both as filled-blue download
// buttons.
//
// We import the artifacts via Vite's `?url` mechanism so they ship in
// the bundle (production) / dev server (development) and resolve to
// runtime URLs the renderer can fetch. On click, the user picks a
// destination via Tauri's save dialog and we write the bytes via the
// Tauri filesystem plugin.
//
// In the test harness the @tauri-apps/plugin-* modules are mocked, so
// the function paths can be exercised without a real Tauri runtime.

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import skillUrl from "../../assets/forgemark-skill.skill?url";
import zipUrl from "../../assets/forgemark-skill.zip?url";

export type SkillTarget = "claude" | "codex";

const DEFAULT_NAMES: Record<SkillTarget, string> = {
  claude: "forgemark-skill.skill",
  codex: "forgemark-skill.zip",
};

const URLS: Record<SkillTarget, string> = {
  claude: skillUrl,
  codex: zipUrl,
};

// Trigger the download dialog and write the bundle to the chosen
// path. Resolves to the path written, or null when the user cancels.
export async function downloadSkill(target: SkillTarget): Promise<string | null> {
  const defaultName = DEFAULT_NAMES[target];
  const chosen = await save({
    defaultPath: defaultName,
    filters: [
      target === "claude"
        ? { name: "Claude skill", extensions: ["skill"] }
        : { name: "Zip archive", extensions: ["zip"] },
    ],
  });
  if (!chosen) return null;

  const bytes = await fetchSkillBytes(URLS[target]);
  await writeFile(chosen, bytes);
  return chosen;
}

async function fetchSkillBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't load skill bundle (${res.status} ${res.statusText})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
