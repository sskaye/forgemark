// The one way to mount the app in an integration test.
//
// Before this, thirteen files defined their own `renderApp`, nine a
// `Probe`, six a `Harness`, and five of them rendered `<DocumentBindings>`
// next to `<AppShell>` — which mounts its own bindings per document — so
// those tests ran two auto-save timers and two watchers against one
// document, and every ⌘S saved twice without anything noticing.

import { render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { DocumentState } from "../../src/state/document";
import type { Comment } from "../../src/format/types";
import type { FakeTauri } from "./tauri-fake";

// The fake Tauri installed by tests/setup.ts.
export const fakeTauri = (globalThis as unknown as { __forgemarkFakeTauri: FakeTauri })
  .__forgemarkFakeTauri;

export type LoadSpec = {
  filePath?: string | null;
  fileName?: string;
  body: string;
  comments?: Comment[];
  readOnly?: boolean;
  format?: DocumentState["format"];
};

// Dispatches one `load` on first render, the way every probe did by hand.
export function LoadOnMount({ spec }: { spec: LoadSpec }) {
  const { dispatch } = useDocument();
  const done = useRef(false);
  if (!done.current) {
    done.current = true;
    const filePath = spec.filePath === undefined ? "/tmp/doc.md" : spec.filePath;
    dispatch({
      type: "load",
      filePath,
      fileName:
        spec.fileName ?? (filePath ? filePath.slice(filePath.lastIndexOf("/") + 1) : "Untitled"),
      text: spec.body,
      body: spec.body,
      comments: spec.comments ?? [],
      readOnly: spec.readOnly ?? false,
      ...(spec.format ? { format: spec.format } : {}),
    });
  }
  return null;
}

// Mount the whole app. `load` puts a document in the first tab; `probe`
// is any component that needs the document context (to expose state or
// dispatch actions for the test).
export function renderApp(
  opts: { load?: LoadSpec; probe?: ReactNode; theme?: "light" | "dark" } = {},
) {
  return render(
    <ThemeProvider initialPreference={opts.theme ?? "light"}>
      <DocumentProvider>
        <AppShell />
        {opts.load && <LoadOnMount spec={opts.load} />}
        {opts.probe}
      </DocumentProvider>
    </ThemeProvider>,
  );
}
