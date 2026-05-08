import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAuthorName,
  useThemePreference,
  useFontSize,
  useDefaultView,
  useRecentFiles,
  useFirstRun,
  FONT_SIZE_RANGE,
} from "../../src/state/preferences";

beforeEach(() => {
  window.localStorage.clear();
});

describe("preferences — author name", () => {
  it("falls back to 'You' when nothing stored", () => {
    const { result } = renderHook(() => useAuthorName());
    expect(result.current[0]).toBe("You");
  });

  it("persists to localStorage and restores", () => {
    const { result, unmount } = renderHook(() => useAuthorName());
    act(() => result.current[1]("Maya"));
    expect(window.localStorage.getItem("forgemark.author")).toBe("Maya");
    unmount();
    const { result: remounted } = renderHook(() => useAuthorName());
    expect(remounted.current[0]).toBe("Maya");
  });
});

describe("preferences — theme", () => {
  it("defaults to 'system'", () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current[0]).toBe("system");
  });

  it("persists across remount", () => {
    const { result, unmount } = renderHook(() => useThemePreference());
    act(() => result.current[1]("dark"));
    unmount();
    const { result: r2 } = renderHook(() => useThemePreference());
    expect(r2.current[0]).toBe("dark");
  });

  it("ignores invalid persisted values", () => {
    window.localStorage.setItem("forgemark.theme", "neon-pink");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current[0]).toBe("system");
  });
});

describe("preferences — font size", () => {
  it("defaults to 17", () => {
    const { result } = renderHook(() => useFontSize());
    expect(result.current[0]).toBe(17);
  });

  it("clamps to range", () => {
    const { result } = renderHook(() => useFontSize());
    act(() => result.current[1](100));
    expect(result.current[0]).toBe(FONT_SIZE_RANGE.max);
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(FONT_SIZE_RANGE.min);
  });
});

describe("preferences — default view", () => {
  it("defaults to 'rendered'", () => {
    const { result } = renderHook(() => useDefaultView());
    expect(result.current[0]).toBe("rendered");
  });

  it("persists 'source'", () => {
    const { result, unmount } = renderHook(() => useDefaultView());
    act(() => result.current[1]("source"));
    unmount();
    const { result: r2 } = renderHook(() => useDefaultView());
    expect(r2.current[0]).toBe("source");
  });
});

describe("preferences — recent files", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useRecentFiles());
    expect(result.current.recent).toEqual([]);
  });

  it("recordOpened pushes most-recent to the top", () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => result.current.recordOpened("/a.md", "a.md"));
    act(() => result.current.recordOpened("/b.md", "b.md"));
    act(() => result.current.recordOpened("/a.md", "a.md")); // re-open — should bubble up
    expect(result.current.recent.map((f) => f.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("caps at 10 entries", () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => {
      for (let i = 0; i < 15; i++) {
        result.current.recordOpened(`/${i}.md`, `${i}.md`);
      }
    });
    expect(result.current.recent).toHaveLength(10);
    // Most-recent first.
    expect(result.current.recent[0].path).toBe("/14.md");
  });

  it("remove drops a single entry", () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => {
      result.current.recordOpened("/a.md", "a.md");
      result.current.recordOpened("/b.md", "b.md");
    });
    act(() => result.current.remove("/a.md"));
    expect(result.current.recent.map((f) => f.path)).toEqual(["/b.md"]);
  });
});

describe("preferences — first run", () => {
  it("starts not-done", () => {
    const { result } = renderHook(() => useFirstRun());
    expect(result.current.firstRunDone).toBe(false);
  });

  it("markDone persists across remount", () => {
    const { result, unmount } = renderHook(() => useFirstRun());
    act(() => result.current.markDone());
    expect(result.current.firstRunDone).toBe(true);
    unmount();
    const { result: r2 } = renderHook(() => useFirstRun());
    expect(r2.current.firstRunDone).toBe(true);
  });
});
