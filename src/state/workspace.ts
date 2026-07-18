import { INITIAL_STATE, reduceDocument, type DocumentAction, type DocumentState } from "./document";

// Phase 1 of multi-document support (see docs/MULTI-DOCUMENT-PLAN.md).
//
// The workspace wraps `reduceDocument` without touching it: every open
// document is still exactly a `DocumentState`, and document-level actions
// are routed to one of them. That is what keeps this change small — the
// reducer, the format layer, and every component that calls
// `useDocument()` are unaffected.
//
// Tab *chrome* is not part of this phase. The app still shows one
// document; this only establishes the state shape underneath it.

export type DocId = string;

export type WorkspaceState = {
  docs: Record<DocId, DocumentState>;
  // Tab order, left to right. Kept separate from `docs` because object key
  // order isn't a contract worth relying on.
  order: DocId[];
  activeId: DocId;
  // Monotonic id source. A counter rather than a random/time-based id so
  // reducer behavior stays deterministic and testable.
  nextDocId: number;
};

export type WorkspaceAction =
  | { type: "openTab"; initial?: Partial<DocumentState> }
  | { type: "closeTab"; docId: DocId }
  | { type: "activateTab"; docId: DocId }
  | { type: "reorderTab"; docId: DocId; toIndex: number }
  // Any document action, optionally aimed at a specific tab. Without
  // `docId` it applies to the active one, which is what every existing
  // caller does.
  | (DocumentAction & { docId?: DocId });

function makeId(n: number): DocId {
  return `doc-${n}`;
}

// Untitled buffers have no path to tell them apart, so number them:
// Untitled, Untitled 2, Untitled 3… Reuses the lowest free index, so
// closing Untitled 2 frees that name for the next new document.
export function nextUntitledName(docs: Record<DocId, DocumentState>): string {
  const taken = new Set(
    Object.values(docs)
      .filter((d) => d.filePath == null)
      .map((d) => d.fileName),
  );
  if (!taken.has(INITIAL_STATE.fileName)) return INITIAL_STATE.fileName;
  for (let n = 2; ; n++) {
    const candidate = `${INITIAL_STATE.fileName} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function createDocument(
  docs: Record<DocId, DocumentState>,
  initial?: Partial<DocumentState>,
): DocumentState {
  const doc: DocumentState = { ...INITIAL_STATE, ...initial };
  // Only auto-name buffers with no path and no explicit name.
  if (doc.filePath == null && initial?.fileName == null) {
    doc.fileName = nextUntitledName(docs);
  }
  return doc;
}

export function createWorkspace(initial?: Partial<DocumentState>): WorkspaceState {
  const id = makeId(1);
  return {
    docs: { [id]: { ...INITIAL_STATE, ...initial } },
    order: [id],
    activeId: id,
    nextDocId: 2,
  };
}

export const INITIAL_WORKSPACE: WorkspaceState = createWorkspace();

export function activeDocument(state: WorkspaceState): DocumentState {
  return state.docs[state.activeId];
}

// True when any open document has unsaved work. Window close and quit
// have to consider every tab, not just the visible one, or unsaved
// background documents disappear without a prompt.
export function anyDirty(state: WorkspaceState): boolean {
  return state.order.some((id) => state.docs[id].dirty);
}

export function findByPath(state: WorkspaceState, filePath: string): DocId | null {
  return state.order.find((id) => state.docs[id].filePath === filePath) ?? null;
}

export function reduceWorkspace(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "openTab": {
      // Opening a file that's already open focuses the existing tab
      // instead of duplicating it. Two tabs on one path would mean two
      // file watchers and two independent auto-save loops writing the
      // same file — they'd overwrite each other, and each write would
      // trip the other's external-change detection.
      const path = action.initial?.filePath;
      if (path != null) {
        const existing = findByPath(state, path);
        if (existing) return state.activeId === existing ? state : { ...state, activeId: existing };
      }
      const id = makeId(state.nextDocId);
      return {
        docs: { ...state.docs, [id]: createDocument(state.docs, action.initial) },
        order: [...state.order, id],
        activeId: id,
        nextDocId: state.nextDocId + 1,
      };
    }

    case "closeTab": {
      if (!state.docs[action.docId]) return state;
      const closedIndex = state.order.indexOf(action.docId);
      const order = state.order.filter((id) => id !== action.docId);
      const docs = { ...state.docs };
      delete docs[action.docId];

      // Closing the last tab leaves an empty Untitled one and keeps the
      // window open (TextEdit / Pages convention, and what File > Close
      // already did before tabs).
      if (order.length === 0) {
        const id = makeId(state.nextDocId);
        return {
          docs: { [id]: { ...INITIAL_STATE } },
          order: [id],
          activeId: id,
          nextDocId: state.nextDocId + 1,
        };
      }

      // Closing the active tab focuses the one that slid into its place,
      // or the new last tab when it was rightmost.
      const activeId =
        state.activeId === action.docId
          ? order[Math.min(closedIndex, order.length - 1)]
          : state.activeId;
      return { ...state, docs, order, activeId };
    }

    case "activateTab": {
      if (!state.docs[action.docId] || state.activeId === action.docId) return state;
      return { ...state, activeId: action.docId };
    }

    case "reorderTab": {
      const from = state.order.indexOf(action.docId);
      if (from === -1) return state;
      const to = Math.max(0, Math.min(action.toIndex, state.order.length - 1));
      if (from === to) return state;
      const order = [...state.order];
      order.splice(from, 1);
      order.splice(to, 0, action.docId);
      return { ...state, order };
    }

    default: {
      // A document action. Route it to its target tab and leave the rest
      // of the workspace alone.
      const id = action.docId ?? state.activeId;
      const doc = state.docs[id];
      if (!doc) return state;
      const next = reduceDocument(doc, action);
      // reduceDocument returns the same object for no-op actions; preserve
      // that so React can skip the re-render.
      if (next === doc) return state;
      return { ...state, docs: { ...state.docs, [id]: next } };
    }
  }
}
