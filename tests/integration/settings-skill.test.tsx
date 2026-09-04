// Settings → AI agents, on screen: the rows for the tools on this
// machine, the state each shows, and what a click does.

import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderApp, fakeTauri } from "../utils/harness";
import { SHIPPED, SHIPPED_FILES } from "../../src/services/skillInstall";
import { SKILL_MANIFEST, hashSkillTree } from "../../src/services/skillTree";
import { formatSent } from "../../src/components/SkillInstallRows";

const HOME = "/home/tester";
const CLAUDE = `${HOME}/.claude/skills/forgemark`;

async function seedOlder(folder: string) {
  const files = SHIPPED_FILES.filter((f) => f.path !== SKILL_MANIFEST).map((f) =>
    f.path === "SKILL.md" ? { ...f, text: "older\n" } : f,
  );
  const tree = await hashSkillTree(files);
  fakeTauri.mkdir(folder);
  for (const f of files) fakeTauri.seed(`${folder}/${f.path}`, f.text);
  fakeTauri.seed(`${folder}/${SKILL_MANIFEST}`, JSON.stringify({ version: "1.4.0", tree }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.firstRunDone", "true");
});

async function openSettings() {
  renderApp();
  fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
  await screen.findByTestId("fm-skill-rows");
}

describe("Settings → AI agents", () => {
  it("shows a row per tool found, and the shared folder", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-code")).toHaveTextContent("Not installed"),
    );
    expect(screen.queryByTestId("fm-skill-row-codex")).toBeNull();
    expect(screen.getByTestId("fm-skill-status-agents")).toHaveTextContent("~/.agents/skills");
  });

  it("installs on a click, then reads up to date with the restart note", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await openSettings();
    const action = await screen.findByTestId("fm-skill-action-claude-code");
    await waitFor(() => expect(action).toBeEnabled());
    expect(action).toHaveTextContent("Install");
    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-code")).toHaveTextContent(
        `Installed ${SHIPPED.version} · new sessions pick it up`,
      ),
    );
    expect(fakeTauri.read(`${CLAUDE}/SKILL.md`)).toBe(
      SHIPPED_FILES.find((f) => f.path === "SKILL.md")!.text,
    );
    expect(screen.getByTestId("fm-skill-action-claude-code")).toHaveTextContent("Update");
    expect(screen.getByTestId("fm-skill-action-claude-code")).toBeDisabled();
  });

  it("offers Update with the version pair for an older install", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await seedOlder(CLAUDE);
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-code")).toHaveTextContent(
        `1.4.0 → ${SHIPPED.version}`,
      ),
    );
    const action = screen.getByTestId("fm-skill-action-claude-code");
    expect(action).toHaveTextContent("Update");
    expect(action).toHaveClass("fm-btn-primary");
    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-row-claude-code")).toHaveAttribute(
        "data-state",
        "current",
      ),
    );
  });

  it("asks before replacing a folder it did not write, and replaces on Replace", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    fakeTauri.mkdir(CLAUDE);
    fakeTauri.seed(`${CLAUDE}/SKILL.md`, "hand-written\n");
    fakeTauri.seed(`${CLAUDE}/notes.md`, "mine\n");
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-code")).toHaveTextContent(
        "Unrecognized folder",
      ),
    );
    fireEvent.click(screen.getByTestId("fm-skill-action-claude-code"));
    const dialog = await screen.findByTestId("fm-skill-replace");
    expect(dialog).toHaveTextContent("~/.claude/skills");
    expect(dialog).toHaveTextContent("2 files");
    // Cancel keeps everything.
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("fm-skill-replace")).toBeNull());
    expect(fakeTauri.read(`${CLAUDE}/notes.md`)).toBe("mine\n");
    // Replace installs.
    fireEvent.click(screen.getByTestId("fm-skill-action-claude-code"));
    fireEvent.click(await screen.findByTestId("fm-skill-replace-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-row-claude-code")).toHaveAttribute(
        "data-state",
        "current",
      ),
    );
    expect(fakeTauri.read(`${CLAUDE}/notes.md`)).toBeUndefined();
  });

  it("reports a failed write on the row and offers Retry, with the old folder intact", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await seedOlder(CLAUDE);
    fakeTauri.fs.writeTextFile.mockImplementationOnce(async () => {
      throw new Error("EACCES: permission denied");
    });
    await openSettings();
    const action = await screen.findByTestId("fm-skill-action-claude-code");
    await waitFor(() => expect(action).toHaveTextContent("Update"));
    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-code")).toHaveTextContent(
        "permission denied",
      ),
    );
    expect(screen.getByTestId("fm-skill-action-claude-code")).toHaveTextContent("Retry");
    expect(fakeTauri.read(`${CLAUDE}/SKILL.md`)).toBe("older\n");
  });

  it("hands the file to the Claude app on Install and remembers the date", async () => {
    fakeTauri.mkdir("/Applications/Claude.app");
    Object.defineProperty(globalThis, "fetch", {
      value: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
      configurable: true,
      writable: true,
    });
    await openSettings();
    const action = await screen.findByTestId("fm-skill-action-claude-app");
    await waitFor(() => expect(action).toBeEnabled());
    expect(action).toHaveTextContent("Install");
    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-app")).toHaveTextContent(
        `Installed ${SHIPPED.version} · Claude asks to install it`,
      ),
    );
    expect(fakeTauri.opener.openPath).toHaveBeenCalledWith(
      expect.stringMatching(/forgemark-skill\.skill$/),
      "Claude",
    );
    // Claude may have declined the file; the row stays open to a retry.
    const again = screen.getByTestId("fm-skill-action-claude-app");
    expect(again).toHaveTextContent("Install again");
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await waitFor(() => expect(fakeTauri.opener.openPath).toHaveBeenCalledTimes(2));
  });

  it("shows the Claude app row as out of date with the date it was last sent", async () => {
    fakeTauri.mkdir("/Applications/Claude.app");
    window.localStorage.setItem(
      "forgemark.skillSent",
      JSON.stringify({ version: "1.4.0", at: "2026-08-12T10:00:00Z" }),
    );
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("fm-skill-status-claude-app")).toHaveTextContent(
        `1.4.0 → ${SHIPPED.version} · sent ${formatSent("2026-08-12T10:00:00Z")}`,
      ),
    );
    expect(screen.getByTestId("fm-skill-action-claude-app")).toHaveTextContent("Update");
  });

  it("keeps a Save skill file button that offers both extensions", async () => {
    fakeTauri.dialog.save.mockResolvedValue("/Users/me/Downloads/forgemark-skill.zip");
    Object.defineProperty(globalThis, "fetch", {
      value: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
      configurable: true,
      writable: true,
    });
    await openSettings();
    fireEvent.click(screen.getByTestId("fm-settings-skill-save"));
    await waitFor(() => expect(fakeTauri.fs.writeFile).toHaveBeenCalled());
    const opts = (
      fakeTauri.dialog.save.mock.calls[0] as unknown as [{ filters: { extensions: string[] }[] }]
    )[0];
    expect(opts.filters.flatMap((f) => f.extensions)).toEqual(["skill", "zip"]);
    expect(fakeTauri.fs.writeFile.mock.calls[0][0]).toBe("/Users/me/Downloads/forgemark-skill.zip");
  });
});

describe("the sidebar notice", () => {
  it("appears when an install is behind, opens Settings, and goes once updated", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await seedOlder(CLAUDE);
    renderApp({ load: { body: "# Doc\n" } });
    const notice = await screen.findByTestId("fm-skill-notice");
    expect(notice).toHaveTextContent("Agent skill out of date");
    fireEvent.click(screen.getByTestId("fm-skill-notice-update"));
    await screen.findByTestId("fm-skill-rows");
    const action = await screen.findByTestId("fm-skill-action-claude-code");
    await waitFor(() => expect(action).toHaveTextContent("Update"));
    fireEvent.click(action);
    await waitFor(() => expect(screen.queryByTestId("fm-skill-notice")).toBeNull());
  });

  it("stays away after a dismissal, for this version", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    await seedOlder(CLAUDE);
    renderApp({ load: { body: "# Doc\n" } });
    fireEvent.click(await screen.findByTestId("fm-skill-notice-dismiss"));
    expect(screen.queryByTestId("fm-skill-notice")).toBeNull();
    expect(window.localStorage.getItem("forgemark.skillNoticeDismissed")).toBe(SHIPPED.version);
  });

  it("does not appear when nothing is installed", async () => {
    fakeTauri.mkdir(`${HOME}/.claude`);
    renderApp({ load: { body: "# Doc\n" } });
    await screen.findByTestId("fm-sidebar");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("fm-skill-notice")).toBeNull();
  });
});

describe("formatSent", () => {
  it("says today, yesterday, or a short date", () => {
    const now = new Date("2026-09-04T12:00:00");
    expect(formatSent("2026-09-04T08:00:00", now)).toBe("today");
    expect(formatSent("2026-09-03T23:00:00", now)).toBe("yesterday");
    expect(formatSent("2026-08-12T10:00:00", now)).toMatch(/12 Aug|Aug 12/);
    expect(formatSent("2025-08-12T10:00:00", now)).toMatch(/2025/);
    expect(formatSent("nonsense", now)).toBe("earlier");
  });
});

describe("when the machine cannot be looked at", () => {
  it("says so in the rows instead of looking forever", async () => {
    fakeTauri.path.homeDir.mockRejectedValue(new Error("path.resolve_directory not allowed"));
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    expect(await screen.findByTestId("fm-skill-detect-error")).toHaveTextContent(/not allowed/);
  });
});
