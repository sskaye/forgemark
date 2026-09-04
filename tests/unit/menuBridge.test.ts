import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  route,
  deliverOpenPath,
  claimQueuedOpenPaths,
  resetOpenPathQueue,
} from "../../src/state/menuBridge";

describe("open paths delivered before the app is listening", () => {
  beforeEach(() => resetOpenPathQueue());

  it("are kept until claimed, then delivered live", () => {
    const seen: string[] = [];
    deliverOpenPath("/early/one.md");
    deliverOpenPath("/early/two.md");
    expect(claimQueuedOpenPaths()).toEqual(["/early/one.md", "/early/two.md"]);
    // Claimed once.
    expect(claimQueuedOpenPaths()).toEqual([]);

    const onOpen = (e: Event) => seen.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener("forgemark:open-path", onOpen);
    deliverOpenPath("/late/three.md");
    window.removeEventListener("forgemark:open-path", onOpen);
    expect(seen).toEqual(["/late/three.md"]);
    // Not queued again: the listener had it.
    expect(claimQueuedOpenPaths()).toEqual([]);
  });
});

describe("menuBridge.route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesizes a keydown for shortcut-mapped ids", () => {
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    route("save");
    expect(onKey).toHaveBeenCalled();
    const e = onKey.mock.calls[0][0] as KeyboardEvent;
    expect(e.key).toBe("s");
    expect(e.metaKey).toBe(true);
    window.removeEventListener("keydown", onKey);
  });

  it("dispatches a forgemark:menu CustomEvent for app-level ids", () => {
    const onCustom = vi.fn();
    window.addEventListener("forgemark:menu", onCustom);
    route("settings");
    expect(onCustom).toHaveBeenCalled();
    const e = onCustom.mock.calls[0][0] as CustomEvent<string>;
    expect(e.detail).toBe("settings");
    route("print");
    expect((onCustom.mock.calls[1][0] as CustomEvent<string>).detail).toBe("print");
    route("find-replace");
    expect((onCustom.mock.calls[2][0] as CustomEvent<string>).detail).toBe("find-replace");
    window.removeEventListener("forgemark:menu", onCustom);
  });

  it("warns on unknown ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    route("definitely-not-real");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
