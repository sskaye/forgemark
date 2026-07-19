import { describe, it, expect } from "vitest";
import { INITIAL_STATE } from "../../src/state/document";
import {
  activeDocument,
  anyDirty,
  createWorkspace,
  findByPath,
  nextUntitledName,
  reduceWorkspace,
  type WorkspaceState,
} from "../../src/state/workspace";

const loadInto = (filePath: string, fileName: string, body = "content\n") => ({
  type: "load" as const,
  filePath,
  fileName,
  text: body,
  body,
  comments: [],
  readOnly: false,
});

// Open a tab already holding a file.
function withFile(state: WorkspaceState, filePath: string, fileName: string): WorkspaceState {
  const opened = reduceWorkspace(state, { type: "openTab", initial: { filePath, fileName } });
  return reduceWorkspace(opened, loadInto(filePath, fileName));
}

describe("workspace — construction", () => {
  it("starts with one Untitled document, active", () => {
    const ws = createWorkspace();
    expect(ws.order).toHaveLength(1);
    expect(ws.activeId).toBe(ws.order[0]);
    expect(activeDocument(ws).fileName).toBe("Untitled");
    expect(activeDocument(ws).filePath).toBeNull();
  });

  it("seeds the first document from initialState (the compatibility seam)", () => {
    // DocumentProvider still accepts Partial<DocumentState>; the existing
    // integration tests depend on it.
    const ws = createWorkspace({ body: "seeded\n", fileName: "seed.md" });
    expect(activeDocument(ws).body).toBe("seeded\n");
    expect(activeDocument(ws).fileName).toBe("seed.md");
  });
});

describe("workspace — document action routing", () => {
  it("applies to the active document by default", () => {
    const ws = createWorkspace();
    const next = reduceWorkspace(ws, { type: "edit", body: "typed\n" });
    expect(activeDocument(next).body).toBe("typed\n");
    expect(activeDocument(next).dirty).toBe(true);
  });

  it("can target a specific tab without disturbing the active one", () => {
    let ws = createWorkspace();
    const firstId = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    const secondId = ws.activeId;
    expect(secondId).not.toBe(firstId);

    ws = reduceWorkspace(ws, { type: "edit", body: "background edit\n", docId: firstId });

    expect(ws.docs[firstId].body).toBe("background edit\n");
    expect(ws.docs[firstId].dirty).toBe(true);
    expect(ws.docs[secondId].body).toBe("");
    expect(ws.activeId).toBe(secondId);
  });

  it("preserves reducer no-ops by identity so React can skip re-renders", () => {
    const ws = createWorkspace();
    // reduceDocument returns the same object when nothing changes.
    const same = reduceWorkspace(ws, { type: "setHoveredComment", id: null });
    expect(same).toBe(ws);
  });

  it("ignores actions aimed at a tab that isn't open", () => {
    const ws = createWorkspace();
    expect(reduceWorkspace(ws, { type: "edit", body: "x", docId: "doc-999" })).toBe(ws);
  });
});

describe("workspace — opening tabs", () => {
  it("appends and focuses the new tab", () => {
    let ws = createWorkspace();
    const firstId = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    expect(ws.order).toHaveLength(2);
    expect(ws.order[0]).toBe(firstId);
    expect(ws.activeId).toBe(ws.order[1]);
  });

  it("focuses the existing tab instead of opening a file twice", () => {
    // Two tabs on one path would run two watchers and two auto-save loops
    // against the same file, overwriting each other and each tripping the
    // other's external-change detection.
    let ws = createWorkspace();
    ws = withFile(ws, "/tmp/a.md", "a.md");
    const aId = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    expect(ws.activeId).not.toBe(aId);

    const before = ws.order.length;
    ws = reduceWorkspace(ws, { type: "openTab", initial: { filePath: "/tmp/a.md" } });

    expect(ws.order).toHaveLength(before);
    expect(ws.activeId).toBe(aId);
  });

  it("numbers Untitled buffers and reuses freed numbers", () => {
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "openTab" });
    ws = reduceWorkspace(ws, { type: "openTab" });
    const names = ws.order.map((id) => ws.docs[id].fileName);
    expect(names).toEqual(["Untitled", "Untitled 2", "Untitled 3"]);

    // Close the middle one; its number becomes available again.
    const untitled2 = ws.order[1];
    ws = reduceWorkspace(ws, { type: "closeTab", docId: untitled2 });
    expect(nextUntitledName(ws.docs)).toBe("Untitled 2");

    ws = reduceWorkspace(ws, { type: "openTab" });
    expect(activeDocument(ws).fileName).toBe("Untitled 2");
  });
});

describe("workspace — closing tabs", () => {
  it("closing the last tab leaves an empty Untitled tab", () => {
    // TextEdit / Pages convention, and what File > Close already did.
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "edit", body: "work\n" });
    ws = reduceWorkspace(ws, { type: "closeTab", docId: ws.activeId });

    expect(ws.order).toHaveLength(1);
    expect(activeDocument(ws).body).toBe("");
    expect(activeDocument(ws).fileName).toBe("Untitled");
    expect(activeDocument(ws).dirty).toBe(false);
  });

  it("focuses the tab that takes the closed one's place", () => {
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "openTab" });
    ws = reduceWorkspace(ws, { type: "openTab" });
    const [, middle, last] = ws.order;

    ws = reduceWorkspace(ws, { type: "activateTab", docId: middle });
    ws = reduceWorkspace(ws, { type: "closeTab", docId: middle });

    expect(ws.order).toHaveLength(2);
    expect(ws.activeId).toBe(last);
  });

  it("falls back to the new last tab when closing the rightmost", () => {
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "openTab" });
    const [first, second] = ws.order;

    ws = reduceWorkspace(ws, { type: "closeTab", docId: second });

    expect(ws.order).toEqual([first]);
    expect(ws.activeId).toBe(first);
  });

  it("closing a background tab leaves focus alone", () => {
    let ws = createWorkspace();
    const first = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    const second = ws.activeId;

    ws = reduceWorkspace(ws, { type: "closeTab", docId: first });

    expect(ws.activeId).toBe(second);
  });

  it("ignores an unknown tab", () => {
    const ws = createWorkspace();
    expect(reduceWorkspace(ws, { type: "closeTab", docId: "nope" })).toBe(ws);
  });
});

describe("workspace — activate and reorder", () => {
  it("activates a tab, and no-ops on the active or unknown one", () => {
    let ws = createWorkspace();
    const first = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });

    const activated = reduceWorkspace(ws, { type: "activateTab", docId: first });
    expect(activated.activeId).toBe(first);
    expect(reduceWorkspace(activated, { type: "activateTab", docId: first })).toBe(activated);
    expect(reduceWorkspace(activated, { type: "activateTab", docId: "nope" })).toBe(activated);
  });

  it("cycles forward and back, wrapping at both ends", () => {
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "openTab" });
    ws = reduceWorkspace(ws, { type: "openTab" });
    const [a, b, c] = ws.order;
    expect(ws.activeId).toBe(c);

    expect(reduceWorkspace(ws, { type: "cycleTab", delta: 1 }).activeId).toBe(a);
    expect(reduceWorkspace(ws, { type: "cycleTab", delta: -1 }).activeId).toBe(b);

    const atFirst = reduceWorkspace(ws, { type: "activateTab", docId: a });
    expect(reduceWorkspace(atFirst, { type: "cycleTab", delta: -1 }).activeId).toBe(c);
  });

  it("cycling is a no-op with a single tab", () => {
    const ws = createWorkspace();
    expect(reduceWorkspace(ws, { type: "cycleTab", delta: 1 })).toBe(ws);
    expect(reduceWorkspace(ws, { type: "cycleTab", delta: -1 })).toBe(ws);
  });

  it("moves a tab and clamps out-of-range targets", () => {
    let ws = createWorkspace();
    ws = reduceWorkspace(ws, { type: "openTab" });
    ws = reduceWorkspace(ws, { type: "openTab" });
    const [a, b, c] = ws.order;

    expect(reduceWorkspace(ws, { type: "reorderTab", docId: a, toIndex: 2 }).order).toEqual([
      b,
      c,
      a,
    ]);
    expect(reduceWorkspace(ws, { type: "reorderTab", docId: c, toIndex: 99 }).order).toEqual([
      a,
      b,
      c,
    ]);
    expect(reduceWorkspace(ws, { type: "reorderTab", docId: c, toIndex: -5 }).order).toEqual([
      c,
      a,
      b,
    ]);
    expect(reduceWorkspace(ws, { type: "reorderTab", docId: a, toIndex: 0 })).toBe(ws);
  });
});

describe("workspace — cross-document queries", () => {
  it("anyDirty sees unsaved work in a background tab", () => {
    // Window close and quit must consider every tab, not just the visible
    // one, or unsaved background documents vanish without a prompt.
    let ws = createWorkspace();
    const background = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    expect(anyDirty(ws)).toBe(false);

    ws = reduceWorkspace(ws, { type: "edit", body: "unsaved\n", docId: background });

    expect(anyDirty(ws)).toBe(true);
    expect(activeDocument(ws).dirty).toBe(false);
  });

  it("findByPath locates an open file", () => {
    let ws = createWorkspace();
    ws = withFile(ws, "/tmp/found.md", "found.md");
    expect(findByPath(ws, "/tmp/found.md")).toBe(ws.activeId);
    expect(findByPath(ws, "/tmp/missing.md")).toBeNull();
  });
});

describe("workspace — isolation between documents", () => {
  it("editing one tab leaves the other's content and undo generation alone", () => {
    let ws = createWorkspace();
    const first = ws.activeId;
    ws = reduceWorkspace(ws, { type: "openTab" });
    const second = ws.activeId;

    ws = reduceWorkspace(ws, loadInto("/tmp/second.md", "second.md", "second body\n"));
    const secondGen = ws.docs[second].loadGeneration;

    ws = reduceWorkspace(ws, { type: "edit", body: "first body\n", docId: first });

    expect(ws.docs[second].body).toBe("second body\n");
    expect(ws.docs[second].loadGeneration).toBe(secondGen);
    expect(ws.docs[first].loadGeneration).toBe(INITIAL_STATE.loadGeneration);
  });
});
