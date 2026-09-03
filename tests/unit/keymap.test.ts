import { describe, it, expect } from "vitest";
import { KEYMAP, commandFor, chordCollisions, type CommandId } from "../../src/state/keymap";

const press = (
  key: string,
  mods: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>> = {},
) =>
  commandFor({
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  });

describe("keymap", () => {
  it("binds every chord to exactly one command", () => {
    // ⌘⇧E was once bound three times. This is the guard.
    expect(chordCollisions()).toEqual([]);
  });

  it("gives every command at least one chord", () => {
    for (const [id, chords] of Object.entries(KEYMAP)) {
      expect(chords.length, id).toBeGreaterThan(0);
    }
  });

  it("names the command a keystroke means", () => {
    expect(press("e", { meta: true, shift: true })).toBe("clean-export");
    expect(press("E", { meta: true, shift: true })).toBe("clean-export");
    expect(press("e", { meta: true })).toBe("find-selection");
    expect(press("e")).toBe("edit-comment");
    expect(press("e", { meta: true, alt: true })).toBe("suggest");
    expect(press("Enter", { meta: true })).toBe("toggle-resolved");
    expect(press("Delete")).toBe("delete-comment");
    expect(press("Backspace")).toBe("delete-comment");
    expect(press("]", { meta: true, shift: true })).toBe("next-tab");
    expect(press("3", { meta: true })).toBe("tab-3");
    expect(press("ArrowDown")).toBe("next-comment");
  });

  it("treats Ctrl as the modifier where there is no ⌘", () => {
    expect(press("s", { ctrl: true })).toBe("save");
    expect(press("s", { ctrl: true, shift: true })).toBe("save-as");
  });

  it("returns null for anything unbound", () => {
    expect(press("x", { meta: true })).toBeNull();
    expect(press("Enter")).toBeNull();
    expect(press("s")).toBeNull();
  });

  it("covers the commands the native menu also lists", () => {
    const menu: CommandId[] = [
      "settings",
      "open",
      "save",
      "save-as",
      "new-tab",
      "clean-export",
      "print",
      "find",
      "comment",
      "suggest",
    ];
    for (const id of menu) expect(KEYMAP[id].length).toBeGreaterThan(0);
  });
});
