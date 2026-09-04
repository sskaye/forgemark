// The Save skill file button in Settings → AI agents: the .skill bytes
// go to the path the dialog chooses, whichever extension the user picks.

import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderApp, fakeTauri } from "../utils/harness";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.firstRunDone", "true");
  Object.defineProperty(globalThis, "fetch", {
    value: async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
    }),
    configurable: true,
    writable: true,
  });
});

describe("Save skill file", () => {
  it("writes the bundle's bytes to the chosen path", async () => {
    fakeTauri.dialog.save.mockResolvedValue("/Users/me/Downloads/forgemark-skill.skill");
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-save"));
    await waitFor(() => expect(fakeTauri.fs.writeFile).toHaveBeenCalledTimes(1));
    expect(fakeTauri.fs.writeFile.mock.calls[0][0]).toBe(
      "/Users/me/Downloads/forgemark-skill.skill",
    );
    expect(fakeTauri.fs.writeFile.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
  });

  it("writes nothing when the dialog is cancelled", async () => {
    fakeTauri.dialog.save.mockResolvedValue(null);
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-save"));
    await waitFor(() => expect(fakeTauri.dialog.save).toHaveBeenCalled());
    expect(fakeTauri.fs.writeFile).not.toHaveBeenCalled();
  });

  it("shows the error when the bundle cannot be read", async () => {
    fakeTauri.dialog.save.mockResolvedValue("/Users/me/Downloads/forgemark-skill.skill");
    Object.defineProperty(globalThis, "fetch", {
      value: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
      configurable: true,
      writable: true,
    });
    renderApp();
    fireEvent.click(screen.getByTestId("fm-titlebar-settings"));
    fireEvent.click(await screen.findByTestId("fm-settings-skill-save"));
    expect(await screen.findByTestId("fm-settings-skill-error")).toHaveTextContent(/404/);
  });
});
