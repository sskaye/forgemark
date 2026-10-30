import { describe, it, expect, vi, beforeEach } from "vitest";

// The updater, the Rust commands and the opener are the app's edges; the
// state machine between them is what these tests pin.
const updater = vi.hoisted(() => ({ check: vi.fn() }));
const core = vi.hoisted(() => ({ invoke: vi.fn() }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => updater);
vi.mock("@tauri-apps/api/core", () => core);
vi.mock("@tauri-apps/plugin-opener", () => opener);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.11.0" }));

import {
  canInstallItself,
  checkForUpdate,
  dismissUpdate,
  downloadUpdate,
  downloadUrl,
  getUpdateState,
  openDownload,
  resetAppUpdateForTests,
  restartToUpdate,
  updateDismissed,
} from "../../src/services/appUpdate";
import { QUIT_EVENT, finishRestart, quitThenOf } from "../../src/state/quit";

const MAC = { os: "macos", arch: "aarch64", appimage: false };
const DEB = { os: "linux", arch: "x86_64", appimage: false };

function fakeUpdate(version = "1.12.0", fail?: Error) {
  return {
    version,
    download: vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      if (fail) throw fail;
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    }),
    install: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  resetAppUpdateForTests();
  updater.check.mockReset();
  core.invoke.mockReset();
  opener.openUrl.mockReset();
  window.localStorage.clear();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  core.invoke.mockImplementation(async (cmd: string) =>
    cmd === "update_target" ? MAC : undefined,
  );
});

describe("where each platform's file is", () => {
  it("names the file the release carries for this install", () => {
    const base = "https://github.com/sskaye/forgemark/releases/download/v1.12.0";
    expect(downloadUrl("1.12.0", MAC)).toBe(`${base}/Forgemark_1.12.0_universal.dmg`);
    expect(downloadUrl("v1.12.0", { os: "windows", arch: "x86_64", appimage: false })).toBe(
      `${base}/Forgemark_1.12.0_x64-setup.exe`,
    );
    expect(downloadUrl("1.12.0", { os: "linux", arch: "aarch64", appimage: true })).toBe(
      `${base}/Forgemark_1.12.0_aarch64.AppImage`,
    );
    // Releases carry no .deb: a .deb install is offered the AppImage.
    expect(downloadUrl("1.12.0", DEB)).toBe(`${base}/Forgemark_1.12.0_amd64.AppImage`);
    expect(downloadUrl("1.12.0", { os: "linux", arch: "aarch64", appimage: false })).toBe(
      `${base}/Forgemark_1.12.0_aarch64.AppImage`,
    );
  });

  it("knows a .deb can't update itself", () => {
    expect(canInstallItself(MAC)).toBe(true);
    expect(canInstallItself({ ...DEB, appimage: true })).toBe(true);
    expect(canInstallItself(DEB)).toBe(false);
  });
});

describe("checking", () => {
  it("offers a newer version", async () => {
    updater.check.mockResolvedValue(fakeUpdate());
    await checkForUpdate();
    expect(getUpdateState()).toEqual({ kind: "available", version: "1.12.0", automatic: true });
  });

  it("offers a .deb install the AppImage's download rather than an update", async () => {
    core.invoke.mockImplementation(async (cmd: string) =>
      cmd === "update_target" ? DEB : undefined,
    );
    updater.check.mockResolvedValue(fakeUpdate());
    await checkForUpdate();
    expect(getUpdateState()).toMatchObject({ kind: "available", automatic: false });
    await openDownload("1.12.0");
    expect(opener.openUrl).toHaveBeenCalledWith(
      "https://github.com/sskaye/forgemark/releases/download/v1.12.0/Forgemark_1.12.0_amd64.AppImage",
    );
  });

  it("stays quiet about an automatic check that fails or finds nothing", async () => {
    updater.check.mockRejectedValue(new Error("offline"));
    await checkForUpdate();
    expect(getUpdateState()).toEqual({ kind: "idle" });
    updater.check.mockResolvedValue(null);
    await checkForUpdate();
    expect(getUpdateState()).toEqual({ kind: "idle" });
  });

  it("reports both when the reader asked", async () => {
    updater.check.mockResolvedValue(null);
    await checkForUpdate({ manual: true });
    expect(getUpdateState()).toEqual({ kind: "current", version: "1.11.0" });
    updater.check.mockRejectedValue(new Error("offline"));
    await checkForUpdate({ manual: true });
    expect(getUpdateState()).toEqual({ kind: "failed", version: null, message: "offline" });
  });

  it("does nothing outside the app", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await checkForUpdate({ manual: true });
    expect(updater.check).not.toHaveBeenCalled();
  });
});

describe("updating", () => {
  it("downloads with progress, then restarts through the unsaved-work walk", async () => {
    const update = fakeUpdate();
    updater.check.mockResolvedValue(update);
    await checkForUpdate();
    const seen: unknown[] = [];
    const pct = () => {
      const s = getUpdateState();
      if (s.kind === "downloading") seen.push(s.received);
    };
    update.download.mockImplementationOnce(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      pct();
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      pct();
      onEvent({ event: "Finished" });
    });
    await downloadUpdate();
    expect(seen).toEqual([0, 40]);
    expect(getUpdateState()).toEqual({ kind: "ready", version: "1.12.0" });
    expect(update.install).not.toHaveBeenCalled();

    // Restart asks for the walk; nothing is installed until it clears.
    const asked: string[] = [];
    const onQuit = (e: Event) => asked.push(quitThenOf(e));
    window.addEventListener(QUIT_EVENT, onQuit);
    restartToUpdate();
    window.removeEventListener(QUIT_EVENT, onQuit);
    expect(asked).toEqual(["restart"]);
    expect(update.install).not.toHaveBeenCalled();

    // The walk, once clear, finishes: install, then relaunch.
    await finishRestart();
    expect(update.install).toHaveBeenCalledOnce();
    expect(core.invoke).toHaveBeenLastCalledWith("restart_app");
  });

  it("offers the download when the update fails to download or install", async () => {
    updater.check.mockResolvedValue(fakeUpdate("1.12.0", new Error("network")));
    await checkForUpdate();
    await downloadUpdate();
    expect(getUpdateState()).toEqual({ kind: "failed", version: "1.12.0", message: "network" });

    resetAppUpdateForTests();
    const update = fakeUpdate();
    update.install.mockRejectedValueOnce(new Error("permission denied"));
    updater.check.mockResolvedValue(update);
    await checkForUpdate();
    await downloadUpdate();
    restartToUpdate();
    await expect(finishRestart()).rejects.toThrow("permission denied");
    expect(getUpdateState()).toEqual({
      kind: "failed",
      version: "1.12.0",
      message: "permission denied",
    });
    expect(core.invoke).not.toHaveBeenCalledWith("restart_app");
  });

  it("remembers Later for that version only", async () => {
    updater.check.mockResolvedValue(fakeUpdate("1.12.0"));
    await checkForUpdate();
    dismissUpdate("1.12.0");
    expect(getUpdateState()).toEqual({ kind: "idle" });
    expect(updateDismissed("1.12.0")).toBe(true);
    expect(updateDismissed("1.12.1")).toBe(false);
  });
});
