import { useState } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "./EditorPane";
import "./AppShell.css";

// Phase 1 shell: chrome on top, editor pane (flex) + sidebar (320px) below.
// Empty editor and empty sidebar are intentional — the document model and
// comment cards land in later phases.
export function AppShell() {
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="fm-app-shell" data-testid="fm-app-shell">
      <TitleBar
        fileName="Untitled"
        modified={false}
        viewMode={viewMode}
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
