// Updating the app from inside it.
//
// The app checks the latest GitHub release's `latest.json` (Tauri's
// updater, configured in tauri.conf.json) at launch and once a day, when
// Settings allows, or whenever the reader asks. A newer version shows a
// banner. Update downloads it and verifies it against the public key the
// app was built with; Restart runs the unsaved-work walk every quit runs
// (`state/quit.ts`) and, once nothing is left unsaved, installs and
// relaunches. Nothing is downloaded or installed without a click.
//
// Where the updater can't replace the app — a Linux .deb is a system
// package — or an automatic update fails, the banner offers the
// release's file for this platform instead, opened straight from the
// release so the reader never has to find it on GitHub. Releases carry
// no .deb since 1.12.1, so a .deb install is offered the AppImage, which
// updates itself from then on.
//
// The state lives here, outside React, so the banner and Settings show
// the same thing; `useAppUpdate` reads it.

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestQuit, setRestartFinisher } from "../state/quit";

const RELEASES = "https://github.com/sskaye/forgemark/releases";
const DISMISSED_KEY = "forgemark.updateDismissed";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 10_000;

export type UpdateTarget = { os: string; arch: string; appimage: boolean };

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  // After a check the reader asked for: nothing newer.
  | { kind: "current"; version: string }
  // `automatic`: the updater can install it here. Otherwise the banner
  // offers the download.
  | { kind: "available"; version: string; automatic: boolean }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  | { kind: "ready"; version: string }
  | { kind: "failed"; version: string | null; message: string };

// ── store ─────────────────────────────────────────────────────────────

let state: UpdateState = { kind: "idle" };
const listeners = new Set<() => void>();
let pending: Update | null = null;
let target: UpdateTarget | null = null;

function setState(next: UpdateState): void {
  state = next;
  for (const l of listeners) l();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
}

// ── where the release keeps each platform's file ──────────────────────

// The file a reader on this platform installs by hand: the same names the
// release workflows give them.
export function downloadUrl(version: string, t: UpdateTarget): string {
  const v = version.replace(/^v/, "");
  const arm = t.arch === "aarch64" || t.arch === "arm64";
  let file: string;
  if (t.os === "macos") file = `Forgemark_${v}_universal.dmg`;
  else if (t.os === "windows") file = `Forgemark_${v}_x64-setup.exe`;
  else if (t.os === "linux") file = `Forgemark_${v}_${arm ? "aarch64" : "amd64"}.AppImage`;
  else return `${RELEASES}/tag/v${v}`;
  return `${RELEASES}/download/v${v}/${file}`;
}

// Whether the updater can replace this install itself.
export function canInstallItself(t: UpdateTarget): boolean {
  return !(t.os === "linux" && !t.appimage);
}

// ── checking ──────────────────────────────────────────────────────────

// Outside the Tauri app (the dev server, tests) there is no updater.
function inApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Look for a newer release. A check the reader asked for (`manual`)
// reports what it found, including "you're up to date" and errors; an
// automatic one stays quiet unless there is something to offer, so being
// offline at launch shows nothing.
export async function checkForUpdate({ manual = false } = {}): Promise<void> {
  if (!inApp()) return;
  if (state.kind === "downloading" || state.kind === "ready") return;
  if (manual) setState({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      setState(manual ? { kind: "current", version: await currentVersion() } : { kind: "idle" });
      return;
    }
    target ??= await invoke<UpdateTarget>("update_target");
    pending = update;
    setState({ kind: "available", version: update.version, automatic: canInstallItself(target) });
  } catch (err) {
    setState(
      manual ? { kind: "failed", version: null, message: messageOf(err) } : { kind: "idle" },
    );
  }
}

async function currentVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

// ── updating ──────────────────────────────────────────────────────────

export async function downloadUpdate(): Promise<void> {
  const update = pending;
  if (!update || state.kind !== "available") return;
  const version = update.version;
  let received = 0;
  let total: number | null = null;
  setState({ kind: "downloading", version, received, total });
  try {
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      if (event.event === "Progress") received += event.data.chunkLength;
      setState({ kind: "downloading", version, received, total });
    });
    setState({ kind: "ready", version });
  } catch (err) {
    setState({ kind: "failed", version, message: messageOf(err) });
  }
}

// Restart into the downloaded update, through the unsaved-work walk.
// If the install itself fails, the walk reports it; the banner then
// offers the download.
export function restartToUpdate(): void {
  if (state.kind !== "ready") return;
  const version = state.version;
  setRestartFinisher(wrapFinisher(version));
  requestQuit("restart");
}

function wrapFinisher(version: string): () => Promise<void> {
  const update = pending;
  return async () => {
    try {
      if (!update) throw new Error("The update is no longer available.");
      await update.install();
      await invoke("restart_app");
    } catch (err) {
      setState({ kind: "failed", version, message: messageOf(err) });
      throw err;
    }
  };
}

// Open this platform's file from the release, for installing by hand.
export async function openDownload(version: string): Promise<void> {
  target ??= await invoke<UpdateTarget>("update_target");
  await openUrl(downloadUrl(version, target));
}

// ── "Later" ───────────────────────────────────────────────────────────

// A dismissal lasts until a newer version than the one dismissed: the
// reader who said "later" to 1.11.0 is not asked again about 1.11.0.
export function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Storage unavailable: the banner just comes back next launch.
  }
  setState({ kind: "idle" });
}

export function updateDismissed(version: string): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.trim() || "Unknown error";
}

// For tests: forget everything.
export function resetAppUpdateForTests(): void {
  state = { kind: "idle" };
  pending = null;
  target = null;
  setRestartFinisher(null);
  for (const l of listeners) l();
}
