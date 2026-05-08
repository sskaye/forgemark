import { useEffect, useState } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "./EditorPane";
import { useDocument } from "../state/DocumentProvider";
import { DocumentBindings } from "../state/DocumentBindings";
import "./AppShell.css";

// Phase 2 shell: the top-level layout, plus the document keyboard bindings
// and auto-save effect. Real content (editor, sidebar comments) lives in
// EditorPane and Sidebar.
export function AppShell() {
  const { state, setViewMode } = useDocument();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Reflect file state in the document title (browser tab and Tauri OS title).
  useEffect(() => {
    const dotted = state.dirty ? "• " : "";
    document.title = `Forgemark — ${dotted}${state.fileName}`;
  }, [state.fileName, state.dirty]);

  return (
    <div className="fm-app-shell" data-testid="fm-app-shell">
      <DocumentBindings />
      <TitleBar
        fileName={state.fileName}
        modified={state.dirty}
        viewMode={state.viewMode}
        onViewModeChange={setViewMode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
      />
      <div className="fm-app-body">
        <EditorPane />
        {sidebarOpen && <Sidebar />}
      </div>
    </div>
  );
}
