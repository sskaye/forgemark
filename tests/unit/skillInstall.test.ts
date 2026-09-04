// Installing the agent skill: what the app finds on disk, how it judges
// an installed copy, and how it swaps a new one in.

import { describe, it, expect, beforeEach } from "vitest";
import { fakeTauri } from "../utils/harness";
import {
  SHIPPED,
  SHIPPED_FILES,
  detectTargets,
  installSkill,
  skillStatus,
  anyInstallOutdated,
  noticeDismissed,
  dismissNotice,
  type SkillTarget,
} from "../../src/services/skillInstall";
import { SKILL_MANIFEST, hashSkillTree } from "../../src/services/skillTree";

const HOME = "/home/tester";
const CLAUDE = `${HOME}/.claude/skills/forgemark`;

function seedTree(folder: string, files: { path: string; text: string }[]) {
  fakeTauri.mkdir(folder);
  for (const f of files) fakeTauri.seed(`${folder}/${f.path}`, f.text);
}

async function olderBuild(): Promise<{ path: string; text: string }[]> {
  // An intact install of an earlier build: different content, and a
  // manifest that still describes it.
  const files = SHIPPED_FILES.filter((f) => f.path !== SKILL_MANIFEST).map((f) =>
    f.path === "SKILL.md" ? { ...f, text: "# Forgemark, an older draft\n" } : f,
  );
  const tree = await hashSkillTree(files);
  return [...files, { path: SKILL_MANIFEST, text: JSON.stringify({ version: "1.4.0", tree }) }];
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("the shipped skill", () => {
  it("is the source tree, with a manifest that describes it", async () => {
    expect(SHIPPED_FILES.map((f) => f.path)).toContain("SKILL.md");
    expect(SHIPPED_FILES.map((f) => f.path)).toContain("scripts/forgemark.mjs");
    expect(await hashSkillTree(SHIPPED_FILES)).toBe(SHIPPED.tree);
  });
});

describe("detectTargets", () => {
  it("lists a tool only when its folder is on this machine, and the shared folder always", async () => {
    expect((await detectTargets()).map((t) => t.id)).toEqual(["agents"]);
    fakeTauri.mkdir(`${HOME}/.claude`);
    fakeTauri.mkdir(`${HOME}/.codex`);
    fakeTauri.mkdir("/Applications/Claude.app");
    const targets = await detectTargets();
    expect(targets.map((t) => t.id)).toEqual(["claude-code", "codex", "claude-app", "agents"]);
    expect(targets[0].folder).toBe(CLAUDE);
    expect(targets[1].folder).toBe(`${HOME}/.codex/skills/forgemark`);
    expect(targets[2].kind).toBe("handoff");
    expect(targets[3].folder).toBe(`${HOME}/.agents/skills/forgemark`);
  });

  it("strips the trailing separator Tauri puts on the home directory", async () => {
    fakeTauri.path.homeDir.mockResolvedValue("/Users/x/");
    fakeTauri.mkdir("/Users/x/.claude");
    expect((await detectTargets())[0].folder).toBe("/Users/x/.claude/skills/forgemark");
  });
});

describe("skillStatus", () => {
  let target: SkillTarget;
  beforeEach(async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    target = (await detectTargets())[0];
  });

  it("is absent when the folder is missing", async () => {
    expect(await skillStatus(target)).toEqual({ kind: "absent" });
  });

  it("is current when the files match what this app ships", async () => {
    seedTree(CLAUDE, [...SHIPPED_FILES]);
    expect(await skillStatus(target)).toEqual({ kind: "current", version: SHIPPED.version });
  });

  it("is outdated for an intact older build, naming its version", async () => {
    seedTree(CLAUDE, await olderBuild());
    expect(await skillStatus(target)).toEqual({ kind: "outdated", installed: "1.4.0" });
  });

  it("is foreign for a folder with no manifest", async () => {
    seedTree(CLAUDE, [{ path: "SKILL.md", text: "someone else's\n" }]);
    const s = await skillStatus(target);
    expect(s.kind).toBe("foreign");
    if (s.kind === "foreign") expect(s.changed).toEqual(["SKILL.md"]);
  });

  it("is foreign for an install that was edited after the fact", async () => {
    const files = await olderBuild();
    seedTree(CLAUDE, files);
    fakeTauri.seed(`${CLAUDE}/AGENTS.md`, "edited by hand\n");
    const s = await skillStatus(target);
    expect(s.kind).toBe("foreign");
    if (s.kind === "foreign") expect(s.changed).toContain("AGENTS.md");
  });

  it("ignores Finder's .DS_Store", async () => {
    seedTree(CLAUDE, [...SHIPPED_FILES, { path: ".DS_Store", text: "" }]);
    expect((await skillStatus(target)).kind).toBe("current");
  });
});

describe("installSkill", () => {
  let target: SkillTarget;
  beforeEach(async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    target = (await detectTargets())[0];
  });

  it("writes the shipped files into a folder that did not exist, parents included", async () => {
    expect(await installSkill(target)).toEqual({ kind: "current", version: SHIPPED.version });
    expect(fakeTauri.read(`${CLAUDE}/SKILL.md`)).toBe(
      SHIPPED_FILES.find((f) => f.path === "SKILL.md")!.text,
    );
    expect(fakeTauri.read(`${CLAUDE}/${SKILL_MANIFEST}`)).toContain(SHIPPED.tree);
    expect(await skillStatus(target)).toEqual({ kind: "current", version: SHIPPED.version });
    // No staging or previous folder left behind.
    expect(fakeTauri.list(`${HOME}/.claude/skills`).every((p) => p.startsWith(CLAUDE + "/"))).toBe(
      true,
    );
  });

  it("replaces an older install and removes its files that no longer ship", async () => {
    seedTree(CLAUDE, [...(await olderBuild()), { path: "old-notes.md", text: "gone\n" }]);
    await installSkill(target);
    expect(fakeTauri.read(`${CLAUDE}/old-notes.md`)).toBeUndefined();
    expect(await skillStatus(target)).toEqual({ kind: "current", version: SHIPPED.version });
    expect(await fakeTauri.fs.exists(`${CLAUDE}.previous`)).toBe(false);
  });

  it("leaves the old folder untouched when a write fails", async () => {
    const before = await olderBuild();
    seedTree(CLAUDE, before);
    fakeTauri.fs.writeTextFile.mockImplementationOnce(async () => {
      throw new Error("EACCES: permission denied");
    });
    await expect(installSkill(target)).rejects.toThrow(/permission denied/);
    expect(fakeTauri.read(`${CLAUDE}/SKILL.md`)).toBe("# Forgemark, an older draft\n");
    expect(await fakeTauri.fs.exists(`${CLAUDE}.installing`)).toBe(false);
    expect(await skillStatus(target)).toEqual({ kind: "outdated", installed: "1.4.0" });
  });

  it("puts the old folder back when the swap itself fails", async () => {
    seedTree(CLAUDE, await olderBuild());
    const rename = fakeTauri.fs.rename.getMockImplementation()!;
    fakeTauri.fs.rename.mockImplementation(async (from: string, to: string) => {
      if (from.endsWith(".installing")) throw new Error("EPERM: rename refused");
      return rename(from, to);
    });
    await expect(installSkill(target)).rejects.toThrow(/rename refused/);
    expect(fakeTauri.read(`${CLAUDE}/SKILL.md`)).toBe("# Forgemark, an older draft\n");
    expect(await fakeTauri.fs.exists(`${CLAUDE}.previous`)).toBe(false);
  });
});

describe("the Claude app hand-off", () => {
  let target: SkillTarget;
  beforeEach(async () => {
    fakeTauri.mkdir("/Applications/Claude.app");
    const fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 3, 4]).buffer,
    });
    Object.defineProperty(globalThis, "fetch", {
      value: fetch,
      configurable: true,
      writable: true,
    });
    target = (await detectTargets()).find((t) => t.id === "claude-app")!;
  });

  it("is absent until the file has been handed over once", async () => {
    expect(await skillStatus(target)).toEqual({ kind: "absent" });
  });

  it("writes the .skill file to the app's data folder and opens it with Claude", async () => {
    const status = await installSkill(target);
    expect(status.kind).toBe("current");
    const [path, app] = fakeTauri.opener.openPath.mock.calls[0] as unknown as [string, string];
    expect(path).toBe("/home/tester/Library/Application Support/forgemark/forgemark-skill.skill");
    expect(app).toBe("Claude");
    expect(fakeTauri.fs.writeFile).toHaveBeenCalledWith(path, expect.any(Uint8Array));
    const after = await skillStatus(target);
    expect(after.kind).toBe("current");
    if (after.kind === "current") expect(after.sentAt).toBeTruthy();
  });

  it("is outdated when the version handed over is older than this app", async () => {
    window.localStorage.setItem(
      "forgemark.skillSent",
      JSON.stringify({ version: "1.4.0", at: "2026-08-12T10:00:00Z" }),
    );
    expect(await skillStatus(target)).toEqual({
      kind: "outdated",
      installed: "1.4.0",
      sentAt: "2026-08-12T10:00:00Z",
    });
  });
});

describe("the launch notice", () => {
  it("is wanted only when a folder install is behind, and not after a dismissal for this version", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    expect(await anyInstallOutdated()).toBe(false);
    seedTree(CLAUDE, await olderBuild());
    expect(await anyInstallOutdated()).toBe(true);
    expect(noticeDismissed()).toBe(false);
    dismissNotice();
    expect(noticeDismissed()).toBe(true);
    // A hand-off that is behind does not count: nothing on disk is stale.
    window.localStorage.clear();
    fakeTauri.reset();
    fakeTauri.mkdir("/Applications/Claude.app");
    window.localStorage.setItem(
      "forgemark.skillSent",
      JSON.stringify({ version: "1.0.0", at: "2026-01-01T00:00:00Z" }),
    );
    expect(await anyInstallOutdated()).toBe(false);
  });
});
