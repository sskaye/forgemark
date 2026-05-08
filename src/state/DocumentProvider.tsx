import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useCallback,
  type ReactNode,
  type Dispatch,
} from "react";
import { INITIAL_STATE, reduceDocument, type DocumentAction, type DocumentState } from "./document";

type DocumentContextValue = {
  state: DocumentState;
  dispatch: Dispatch<DocumentAction>;
  setBody: (body: string) => void;
  setViewMode: (mode: "rendered" | "source") => void;
};

const DocumentContext = createContext<DocumentContextValue | null>(null);

export function DocumentProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<DocumentState>;
}) {
  const [state, dispatch] = useReducer(reduceDocument, {
    ...INITIAL_STATE,
    ...initialState,
  });

  const setBody = useCallback((body: string) => dispatch({ type: "edit", body }), []);
  const setViewMode = useCallback(
    (viewMode: "rendered" | "source") => dispatch({ type: "setViewMode", viewMode }),
    [],
  );

  const value = useMemo(
    () => ({ state, dispatch, setBody, setViewMode }),
    [state, setBody, setViewMode],
  );

  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) throw new Error("useDocument must be used inside <DocumentProvider>");
  return ctx;
}
