import { describe, it, expect } from "vitest";
import { reduceDocument, INITIAL_STATE } from "../../src/state/document";

const baseLoad = {
  type: "load" as const,
  filePath: "/tmp/a.md",
  fileName: "a.md",
  text: "alpha",
  body: "alpha",
  comments: [],
  readOnly: false,
};

describe("document reducer", () => {
  it("starts in the Untitled state", () => {
    expect(INITIAL_STATE.fileName).toBe("Untitled");
    expect(INITIAL_STATE.filePath).toBe(null);
    expect(INITIAL_STATE.dirty).toBe(false);
    expect(INITIAL_STATE.comments).toEqual([]);
    expect(INITIAL_STATE.focusedCommentId).toBe(null);
    expect(INITIAL_STATE.hoveredCommentId).toBe(null);
  });

  it("loads a file and resets dirty/viewMode/focus", () => {
    const next = reduceDocument(
      {
        ...INITIAL_STATE,
        dirty: true,
        viewMode: "source",
        focusedCommentId: 42,
        hoveredCommentId: 99,
      },
      {
        type: "load",
        filePath: "/tmp/example.md",
        fileName: "example.md",
        text: "# Hello\n",
        body: "# Hello\n",
        comments: [],
        readOnly: false,
      },
    );
    expect(next.filePath).toBe("/tmp/example.md");
    expect(next.fileName).toBe("example.md");
    expect(next.body).toBe("# Hello\n");
    expect(next.originalText).toBe("# Hello\n");
    expect(next.dirty).toBe(false);
    expect(next.viewMode).toBe("rendered");
    expect(next.focusedCommentId).toBe(null);
    expect(next.hoveredCommentId).toBe(null);
  });

  it("edit marks dirty whenever body changes", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    expect(edited.dirty).toBe(true);
    expect(edited.body).toBe("alpha bravo");
  });

  it("editSource updates body and comments together and marks dirty", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const comment = {
      id: 1,
      author: "Maya",
      timestamp: "2026-05-07T09:00:00Z",
      resolved: false,
      anchor_text: "alpha",
      body: "note\n",
    };
    const edited = reduceDocument(loaded, {
      type: "editSource",
      body: "alpha edited",
      comments: [comment],
    });
    expect(edited.dirty).toBe(true);
    expect(edited.body).toBe("alpha edited");
    expect(edited.comments).toEqual([comment]);
  });

  it("editSource is a no-op when body and comments are unchanged", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const next = reduceDocument(loaded, {
      type: "editSource",
      body: loaded.body,
      comments: loaded.comments,
    });
    expect(next).toBe(loaded);
    expect(next.dirty).toBe(false);
  });

  it("edit back to the original body still marks dirty (the user did edit)", () => {
    // After Phase 4, edits go through the format serializer on save, so
    // matching `originalText` no longer means "no change to write" — the
    // round-trip might have intentional formatting differences. Edits are
    // dirty until explicitly saved.
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    expect(edited.dirty).toBe(true);
    const reverted = reduceDocument(edited, { type: "edit", body: "alpha" });
    expect(reverted.dirty).toBe(true);
  });

  it("edit with no body change is a no-op", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const same = reduceDocument(loaded, { type: "edit", body: "alpha" });
    expect(same).toBe(loaded);
  });

  it("saved updates originalText and body and clears dirty", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    const saved = reduceDocument(edited, {
      type: "saved",
      text: "serialized form",
      body: "alpha bravo",
    });
    expect(saved.dirty).toBe(false);
    expect(saved.originalText).toBe("serialized form");
    expect(saved.body).toBe("alpha bravo");
  });

  it("setViewMode toggles the per-document mode", () => {
    const next = reduceDocument(INITIAL_STATE, { type: "setViewMode", viewMode: "source" });
    expect(next.viewMode).toBe("source");
  });

  it("newUntitled resets to the initial state", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const fresh = reduceDocument(loaded, { type: "newUntitled" });
    expect(fresh).toEqual(INITIAL_STATE);
  });

  it("load preserves read-only state", () => {
    const next = reduceDocument(INITIAL_STATE, {
      ...baseLoad,
      filePath: "/tmp/ro.md",
      fileName: "ro.md",
      readOnly: true,
    });
    expect(next.readOnly).toBe(true);
  });

  it("setFocusedComment / setHoveredComment update the UI state", () => {
    const focused = reduceDocument(INITIAL_STATE, { type: "setFocusedComment", id: 7 });
    expect(focused.focusedCommentId).toBe(7);
    const hovered = reduceDocument(focused, { type: "setHoveredComment", id: 12 });
    expect(hovered.hoveredCommentId).toBe(12);
    // Re-dispatching the same value is a no-op (same object reference).
    const same = reduceDocument(hovered, { type: "setHoveredComment", id: 12 });
    expect(same).toBe(hovered);
  });
});
