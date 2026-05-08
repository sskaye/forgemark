import { describe, it, expect } from "vitest";
import { reduceDocument, INITIAL_STATE } from "../../src/state/document";

describe("document reducer", () => {
  it("starts in the Untitled state", () => {
    expect(INITIAL_STATE.fileName).toBe("Untitled");
    expect(INITIAL_STATE.filePath).toBe(null);
    expect(INITIAL_STATE.dirty).toBe(false);
  });

  it("loads a file and resets dirty/viewMode", () => {
    const next = reduceDocument(
      { ...INITIAL_STATE, dirty: true, viewMode: "source" },
      {
        type: "load",
        filePath: "/tmp/example.md",
        fileName: "example.md",
        text: "# Hello\n",
        readOnly: false,
      },
    );
    expect(next.filePath).toBe("/tmp/example.md");
    expect(next.fileName).toBe("example.md");
    expect(next.body).toBe("# Hello\n");
    expect(next.originalText).toBe("# Hello\n");
    expect(next.dirty).toBe(false);
    expect(next.viewMode).toBe("rendered");
  });

  it("edit marks dirty when body diverges from originalText", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/a.md",
      fileName: "a.md",
      text: "alpha",
      readOnly: false,
    });
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    expect(edited.dirty).toBe(true);
    expect(edited.body).toBe("alpha bravo");
  });

  it("edit back to original clears the dirty flag", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/a.md",
      fileName: "a.md",
      text: "alpha",
      readOnly: false,
    });
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    expect(edited.dirty).toBe(true);
    const reverted = reduceDocument(edited, { type: "edit", body: "alpha" });
    expect(reverted.dirty).toBe(false);
  });

  it("edit with no body change is a no-op", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/a.md",
      fileName: "a.md",
      text: "alpha",
      readOnly: false,
    });
    const same = reduceDocument(loaded, { type: "edit", body: "alpha" });
    expect(same).toBe(loaded);
  });

  it("saved updates originalText and clears dirty", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/a.md",
      fileName: "a.md",
      text: "alpha",
      readOnly: false,
    });
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    const saved = reduceDocument(edited, { type: "saved", text: "alpha bravo" });
    expect(saved.dirty).toBe(false);
    expect(saved.originalText).toBe("alpha bravo");
    expect(saved.body).toBe("alpha bravo");
  });

  it("setViewMode toggles the per-document mode", () => {
    const next = reduceDocument(INITIAL_STATE, { type: "setViewMode", viewMode: "source" });
    expect(next.viewMode).toBe("source");
  });

  it("newUntitled resets to the initial state", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/a.md",
      fileName: "a.md",
      text: "alpha",
      readOnly: false,
    });
    const fresh = reduceDocument(loaded, { type: "newUntitled" });
    expect(fresh).toEqual(INITIAL_STATE);
  });

  it("load preserves read-only state", () => {
    const next = reduceDocument(INITIAL_STATE, {
      type: "load",
      filePath: "/tmp/ro.md",
      fileName: "ro.md",
      text: "x",
      readOnly: true,
    });
    expect(next.readOnly).toBe(true);
  });
});
