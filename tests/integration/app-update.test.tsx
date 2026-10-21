import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useWorkspace } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdate, resetAppUpdateForTests } from "../../src/services/appUpdate";

// The update banner in the app: Update downloads, Restart goes through the
// unsaved-work prompt every quit gets, and only a clear walk installs and
// relaunches.

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => updater);

function fakeUpdate() {
  return {
    version: "1.12.0",
    download: vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 10 } });
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
      onEvent({ event: "Finished" });
    }),
    install: vi.fn(async () => undefined),
  };
}

function Probe() {
  const { dispatch } = useWorkspace();
  return (
    <button
      data-testid="edit"
      onClick={() => dispatch({ type: "edit", body: "precious work\n" })}
    />
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
        <Probe />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

async function offered() {
  const update = fakeUpdate();
  updater.check.mockResolvedValue(update);
  await act(async () => {
    await checkForUpdate();
  });
  return update;
}

describe("the update banner", () => {
  beforeEach(() => {
    resetAppUpdateForTests();
    window.localStorage.clear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "update_target" ? { os: "macos", arch: "aarch64", appimage: false } : undefined,
    );
  });

  it("downloads on Update, then installs and relaunches on Restart", async () => {
    mount();
    const update = await offered();
    expect(screen.getByTestId("fm-update-banner").textContent).toContain(
      "Forgemark 1.12.0 is available.",
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-update-install"));
    });
    expect(await screen.findByTestId("fm-update-restart")).toBeTruthy();
    expect(update.install).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-update-restart"));
    });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("restart_app"));
    expect(update.install).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("approve_exit");
  });

  it("asks about unsaved work before installing, and installs nothing on Cancel", async () => {
    mount();
    const update = await offered();
    await act(async () => {
      screen.getByTestId("edit").click();
      fireEvent.click(screen.getByTestId("fm-update-install"));
    });
    await screen.findByTestId("fm-update-restart");
    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-update-restart"));
    });
    expect(await screen.findByTestId("fm-unsaved-modal")).toBeTruthy();
    expect(update.install).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("fm-unsaved-cancel"));
    });
    await waitFor(() => expect(screen.queryByTestId("fm-unsaved-modal")).toBeNull());
    expect(update.install).not.toHaveBeenCalled();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("restart_app");
  });

  it("installs once the reader discards the unsaved work", async () => {
    mount();
    const update = await offered();
    await act(async () => {
      screen.getByTestId("edit").click();
      fireEvent.click(screen.getByTestId("fm-update-install"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("fm-update-restart"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("fm-unsaved-discard"));
    });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("restart_app"));
    expect(update.install).toHaveBeenCalledOnce();
  });

  it("hides on Later until a newer version", async () => {
    mount();
    await offered();
    await act(async () => {
      fireEvent.click(screen.getByText("Later"));
    });
    expect(screen.queryByTestId("fm-update-banner")).toBeNull();
    await offered();
    expect(screen.queryByTestId("fm-update-banner")).toBeNull();
  });
});
