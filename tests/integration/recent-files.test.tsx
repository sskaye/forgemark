import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useWorkspace } from "../../src/state/DocumentProvider";
import { renderApp, fakeTauri } from "../utils/harness";
import { route } from "../../src/state/menuBridge";

// File > Open Recent is a native submenu the frontend keeps up to date:
// every open pushes the list to Rust, a click on an entry comes back as
// an open-path event, a failed open drops its entry, and Clear Menu
// empties it.

function Probe() {
  const { workspace } = useWorkspace();
  return <span data-testid="probe-active">{workspace.docs[workspace.activeId].fileName}</span>;
}

const setRecentCalls = () =>
  (fakeTauri.core.invoke.mock.calls as unknown as [string, { paths: string[] }][])
    .filter(([cmd]) => cmd === "set_recent_files")
    .map(([, args]) => args.paths);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

describe("Open Recent", () => {
  it("pushes the list to the native menu as files are opened", async () => {
    fakeTauri.seed("/notes/first.md", "first\n");
    fakeTauri.seed("/notes/second.md", "second\n");
    renderApp({ probe: <Probe /> });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual([]));

    fakeTauri.dialog.open.mockResolvedValue(["/notes/first.md"]);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("first.md"));
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual(["/notes/first.md"]));

    fakeTauri.dialog.open.mockResolvedValue(["/notes/second.md"]);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("second.md"));
    await waitFor(() =>
      expect(setRecentCalls().at(-1)).toEqual(["/notes/second.md", "/notes/first.md"]),
    );
  });

  it("opens an entry through the same event a Finder open uses", async () => {
    fakeTauri.seed("/notes/again.md", "again\n");
    renderApp({ probe: <Probe /> });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("forgemark:open-path", { detail: { path: "/notes/again.md" } }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("again.md"));
  });

  it("drops an entry the app could not open, and says what went wrong", async () => {
    fakeTauri.seed("/notes/gone.md", "x\n");
    renderApp({ probe: <Probe /> });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual([]));
    fakeTauri.dialog.open.mockResolvedValue(["/notes/gone.md"]);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual(["/notes/gone.md"]));

    // Deleted since. Opening it from the menu fails and it leaves the list.
    fakeTauri.fs.stat.mockRejectedValueOnce(new Error("ENOENT: /notes/gone.md"));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("forgemark:open-path", { detail: { path: "/notes/gone.md" } }),
      );
    });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual([]));
    expect(screen.getByTestId("fm-error-banner").textContent).toMatch(/Open failed/);
  });

  it("Clear Menu empties the list", async () => {
    fakeTauri.seed("/notes/first.md", "first\n");
    renderApp({ probe: <Probe /> });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual([]));
    fakeTauri.dialog.open.mockResolvedValue(["/notes/first.md"]);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual(["/notes/first.md"]));

    await act(async () => {
      route("recent-clear");
    });
    await waitFor(() => expect(setRecentCalls().at(-1)).toEqual([]));
  });
});
