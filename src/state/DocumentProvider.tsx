import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useCallback,
  type ReactNode,
  type Dispatch,
} from "react";
import { type DocumentAction, type DocumentState } from "./document";
import {
  activeDocument,
  createWorkspace,
  reduceWorkspace,
  type DocId,
  type WorkspaceAction,
  type WorkspaceState,
} from "./workspace";

type DocumentContextValue = {
  state: DocumentState;
  dispatch: Dispatch<DocumentAction>;
  setBody: (body: string) => void;
  setViewMode: (mode: "rendered" | "source") => void;
};

type WorkspaceContextValue = {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  // Address a specific tab rather than the active one. Phase 2 needs this
  // for per-document side effects (each open document runs its own
  // auto-save and file watcher, including while it's in the background).
  dispatchTo: (docId: DocId) => Dispatch<DocumentAction>;
};

const DocumentContext = createContext<DocumentContextValue | null>(null);
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// The provider owns a workspace of documents, but `useDocument()` still
// hands back a single DocumentState — the active one — with exactly the
// shape it had before. That's deliberate: the reducer, the format layer,
// and every existing consumer and test carry on unchanged while the state
// underneath grows a tab dimension.
export function DocumentProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  // Unchanged from the single-document API: seeds the first document.
  // Tests rely on this, so it stays the compatibility seam.
  initialState?: Partial<DocumentState>;
}) {
  const [workspace, dispatchWorkspace] = useReducer(
    reduceWorkspace,
    initialState,
    createWorkspace as (init?: Partial<DocumentState>) => WorkspaceState,
  );

  const state = activeDocument(workspace);

  // Document actions land on the active tab unless a caller says otherwise.
  const dispatch = dispatchWorkspace as Dispatch<DocumentAction>;

  const dispatchTo = useCallback(
    (docId: DocId): Dispatch<DocumentAction> =>
      (action: DocumentAction) =>
        dispatchWorkspace({ ...action, docId } as WorkspaceAction),
    [],
  );

  const setBody = useCallback((body: string) => dispatch({ type: "edit", body }), [dispatch]);
  const setViewMode = useCallback(
    (viewMode: "rendered" | "source") => dispatch({ type: "setViewMode", viewMode }),
    [dispatch],
  );

  const documentValue = useMemo(
    () => ({ state, dispatch, setBody, setViewMode }),
    [state, dispatch, setBody, setViewMode],
  );

  const workspaceValue = useMemo(
    () => ({ workspace, dispatch: dispatchWorkspace, dispatchTo }),
    [workspace, dispatchTo],
  );

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <DocumentContext.Provider value={documentValue}>{children}</DocumentContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) throw new Error("useDocument must be used inside <DocumentProvider>");
  return ctx;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <DocumentProvider>");
  return ctx;
}
