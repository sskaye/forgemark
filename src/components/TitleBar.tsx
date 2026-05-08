import "./TitleBar.css";

type Props = {
  fileName: string;
  modified: boolean;
  viewMode: "rendered" | "source";
  onViewModeChange: (m: "rendered" | "source") => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  // Phase 11: opens the Settings modal. Until the native macOS menu
  // bar lands, this gear button is the discoverable mouse path.
  onOpenSettings?: () => void;
};

// 44px combined chrome — standard macOS titlebar-with-toolbar shape.
// On macOS the OS provides the traffic-light controls at the top-left;
// `data-tauri-drag-region` makes the rest of the bar a draggable surface.
// We pad the left side enough for the traffic lights (~70px is safe).
export function TitleBar({
  fileName,
  modified,
  viewMode,
  onViewModeChange,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
}: Props) {
  return (
    <header className="fm-titlebar" data-tauri-drag-region data-testid="fm-titlebar" role="banner">
      <div className="fm-titlebar-traffic-spacer" aria-hidden="true" />

      <div className="fm-titlebar-title" data-tauri-drag-region>
        {modified && <span className="fm-titlebar-modified-dot" aria-label="modified" />}
        <span className="fm-titlebar-filename">{fileName}</span>
      </div>

      <div className="fm-titlebar-actions">
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        <SidebarToggle open={sidebarOpen} onClick={onToggleSidebar} />
        {onOpenSettings && <SettingsButton onClick={onOpenSettings} />}
      </div>
    </header>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="fm-iconbtn"
      title="Settings (⌘,)"
      aria-label="Open settings"
      onClick={onClick}
      data-testid="fm-titlebar-settings"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
        <path
          d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: "rendered" | "source";
  onChange: (v: "rendered" | "source") => void;
}) {
  return (
    <div className="fm-segmented" role="tablist" aria-label="View mode">
      {(["rendered", "source"] as const).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            className={"fm-segmented-button" + (active ? " is-active" : "")}
            onClick={() => onChange(mode)}
          >
            {mode === "rendered" ? "Rendered" : "Source"}
          </button>
        );
      })}
    </div>
  );
}

function SidebarToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="fm-iconbtn"
      title={open ? "Hide comments" : "Show comments"}
      aria-label={open ? "Hide comments" : "Show comments"}
      aria-pressed={open}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.1"
          fill={open ? "currentColor" : "none"}
          fillOpacity={open ? 0.12 : 0}
        />
        <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    </button>
  );
}
