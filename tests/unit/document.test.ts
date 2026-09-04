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

  it("saved updates originalText and clears dirty when nothing moved", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    const saved = reduceDocument(edited, {
      type: "saved",
      text: "serialized form",
      body: "alpha bravo",
      comments: edited.comments,
    });
    expect(saved.dirty).toBe(false);
    expect(saved.originalText).toBe("serialized form");
    expect(saved.body).toBe("alpha bravo");
  });

  it("saved keeps an edit that landed while the write was in flight", () => {
    // The write serialized "alpha bravo"; the user typed on before it
    // finished. The newer body must survive and stay dirty so the next
    // auto-save writes it — it used to be replaced by the snapshot.
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const edited = reduceDocument(loaded, { type: "edit", body: "alpha bravo" });
    const typedOn = reduceDocument(edited, { type: "edit", body: "alpha bravo charlie" });
    const saved = reduceDocument(typedOn, {
      type: "saved",
      text: "serialized form",
      body: "alpha bravo",
      comments: edited.comments,
    });
    expect(saved.body).toBe("alpha bravo charlie");
    expect(saved.dirty).toBe(true);
    expect(saved.originalText).toBe("serialized form");
  });

  it("deleteComment remembers the deletion and undoDelete restores it exactly", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      ...baseLoad,
      body: "x <!-- fmc:1 -->a<!-- /fmc:1 --> y",
      comments: [
        {
          id: 1,
          anchor_text: "a",
          author: "A",
          timestamp: "2026-05-07T09:00:00Z",
          resolved: false,
          body: "b\n",
          replies: [{ author: "B", timestamp: "2026-05-07T10:00:00Z", body: "r\n" }],
        },
      ],
    });
    const deleted = reduceDocument(loaded, { type: "deleteComment", commentId: 1 });
    expect(deleted.comments).toEqual([]);
    expect(deleted.lastDeleted?.comment.id).toBe(1);

    const restored = reduceDocument(deleted, { type: "undoDelete" });
    expect(restored.body).toBe(loaded.body);
    expect(restored.comments).toEqual(loaded.comments);
    expect(restored.lastDeleted).toBeNull();
    expect(restored.dirty).toBe(true);
    expect(restored.focusedCommentId).toBe(1);
  });

  it("any other change to the body or comments forfeits the undo", () => {
    const loaded = reduceDocument(INITIAL_STATE, {
      ...baseLoad,
      body: "x <!-- fmc:1 -->a<!-- /fmc:1 --> y",
      comments: [
        { id: 1, anchor_text: "a", author: "A", timestamp: "t", resolved: false, body: "b\n" },
      ],
    });
    const deleted = reduceDocument(loaded, { type: "deleteComment", commentId: 1 });
    const typed = reduceDocument(deleted, { type: "edit", body: "x a y z" });
    expect(typed.lastDeleted).toBeNull();
    // Restoring the old body over the new text would lose the text.
    expect(reduceDocument(typed, { type: "undoDelete" })).toBe(typed);
    // Resolving a comment changes no body: the undo survives it.
    const other = reduceDocument(deleted, { type: "setFilter", filter: { kind: "open" } });
    expect(other.lastDeleted).not.toBeNull();
  });

  it("setViewMode toggles the per-document mode", () => {
    const next = reduceDocument(INITIAL_STATE, { type: "setViewMode", viewMode: "source" });
    expect(next.viewMode).toBe("source");
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

// `loadGeneration` is the key the rendered editor remounts on. Remounting
// is what discards the Tiptap undo stack, so these assertions are really
// about undo isolation: a bumped generation means "⌘Z must not reach the
// previous content", a stable one means "the user keeps their history".
describe("document reducer — loadGeneration (undo isolation)", () => {
  it("bumps on load so undo can't reach the previous document", () => {
    const first = reduceDocument(INITIAL_STATE, baseLoad);
    expect(first.loadGeneration).toBe(INITIAL_STATE.loadGeneration + 1);

    const second = reduceDocument(first, {
      ...baseLoad,
      filePath: "/tmp/b.md",
      fileName: "b.md",
      text: "beta",
      body: "beta",
    });
    expect(second.loadGeneration).toBe(first.loadGeneration + 1);
  });

  it("does NOT bump when Save As rebinds the path", () => {
    // Save As is a `saved` with a new path — it's the same buffer the
    // user has been editing, so their undo history, view mode, and
    // focus all have to survive.
    const loaded = reduceDocument(reduceDocument(INITIAL_STATE, baseLoad), {
      type: "setViewMode",
      viewMode: "source",
    });
    const renamed = reduceDocument(loaded, {
      type: "saved",
      text: loaded.originalText,
      body: loaded.body,
      comments: loaded.comments,
      filePath: "/tmp/renamed.md",
      fileName: "renamed.md",
    });
    expect(renamed.filePath).toBe("/tmp/renamed.md");
    expect(renamed.fileName).toBe("renamed.md");
    expect(renamed.loadGeneration).toBe(loaded.loadGeneration);
    expect(renamed.viewMode).toBe("source");
    expect(renamed.dirty).toBe(false);
  });

  it("bumps on reload-from-disk", () => {
    // The disk bytes replace the buffer, so the undo stack describes
    // text that no longer exists.
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const conflicted = reduceDocument(loaded, {
      type: "externalChangeDetected",
      text: "alpha from disk",
      body: "alpha from disk",
      comments: [],
      fingerprint: { mtimeMs: 1, hash: "abc" },
    });
    const reloaded = reduceDocument(conflicted, { type: "applyExternalChange" });
    expect(reloaded.body).toBe("alpha from disk");
    expect(reloaded.loadGeneration).toBe(loaded.loadGeneration + 1);
  });

  it("does not bump on ordinary edits", () => {
    const loaded = reduceDocument(INITIAL_STATE, baseLoad);
    const typed = reduceDocument(loaded, { type: "edit", body: "alpha and more" });
    expect(typed.loadGeneration).toBe(loaded.loadGeneration);
  });
});

describe("document reducer — editing the source", () => {
  const FILE =
    "# T\n\nA <!-- fmc:1 -->word<!-- /fmc:1 --> here.\n\n<!-- forgemark-comments\n- id: 1\n  anchor_text: word\n  author: A\n  timestamp: 2026-01-01T00:00:00Z\n  resolved: false\n  body: |\n    hi\n-->\n";
  const loaded = reduceDocument(INITIAL_STATE, {
    ...baseLoad,
    text: FILE,
    body: "# T\n\nA <!-- fmc:1 -->word<!-- /fmc:1 --> here.\n",
    comments: [
      {
        id: 1,
        anchor_text: "word",
        author: "A",
        timestamp: "2026-01-01T00:00:00Z",
        resolved: false,
        body: "hi\n",
      },
    ],
  });

  it("editSource keeps the text as typed, reads it tolerantly, and marks dirty", () => {
    const typed = FILE.replace("A <!-- fmc:1 -->word", "A big <!-- fmc:1 -->word");
    const next = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: typed },
    );
    expect(next.sourceDraft).toBe(typed);
    expect(next.dirty).toBe(true);
    expect(next.body).toContain("A big ");
    expect(next.comments.map((c) => c.id)).toEqual([1]);
    // The same text again changes nothing.
    expect(reduceDocument(next, { type: "editSource", text: typed })).toBe(next);
  });

  it("editSource keeps the last readable comments while a record is half typed", () => {
    const broken = FILE.replace("  resolved: false\n", "  resolved: fal");
    const next = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: broken },
    );
    expect(next.sourceDraft).toBe(broken);
    expect(next.comments.map((c) => c.id)).toEqual([1]);
  });

  it("commitSource makes a clean draft the document and starts the editor over", () => {
    const typed = FILE.replace("here.", "there.");
    const drafted = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: typed },
    );
    const next = reduceDocument(drafted, { type: "commitSource" });
    expect(next.sourceDraft).toBe(null);
    expect(next.viewMode).toBe("rendered");
    expect(next.body).toContain("there.");
    expect(next.comments).toHaveLength(1);
    expect(next.loadGeneration).toBe(drafted.loadGeneration + 1);
    expect(next.dirty).toBe(true);
  });

  it("commitSource refuses a draft the parser cannot read, and stays in Source", () => {
    const broken = FILE + "\n<!-- forgemark-comments\n- id: 2\n-->\n";
    const drafted = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: broken },
    );
    const next = reduceDocument(drafted, { type: "commitSource" });
    expect(next.viewMode).toBe("source");
    expect(next.sourceDraft).toBe(broken);
    expect(next.error).toMatch(/can't be read/);
  });

  it("commitSource without a draft just leaves Source view", () => {
    const next = reduceDocument({ ...loaded, viewMode: "source" }, { type: "commitSource" });
    expect(next.viewMode).toBe("rendered");
    expect(next.loadGeneration).toBe(loaded.loadGeneration);
  });

  it("saved clears dirty when the draft is what was written, and not otherwise", () => {
    const typed = FILE.replace("here.", "there.");
    const drafted = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: typed },
    );
    const clean = reduceDocument(drafted, {
      type: "saved",
      text: typed,
      body: drafted.body,
      comments: drafted.comments,
    });
    expect(clean.dirty).toBe(false);
    expect(clean.sourceDraft).toBe(typed);
    const stale = reduceDocument(drafted, {
      type: "saved",
      text: FILE,
      body: drafted.body,
      comments: drafted.comments,
    });
    expect(stale.dirty).toBe(true);
  });

  it("a load or a reload from disk drops the draft", () => {
    const drafted = reduceDocument(
      { ...loaded, viewMode: "source" },
      { type: "editSource", text: FILE + "x" },
    );
    expect(reduceDocument(drafted, baseLoad).sourceDraft).toBe(null);
  });
});
