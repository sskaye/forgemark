// chrome.jsx — macOS window chrome for Forgemark.
// Title bar with traffic lights, document title with modified-state dot,
// toolbar with view-toggle (Rendered / Source) and right-side actions.

const FM_TRAFFIC = ({ onClose, dimmed = false }) => {
  const dot = (bg, label, onClick) => (
    <button
      aria-label={label}
      onClick={onClick}
      className="fm-tl"
      style={{
        width: 12, height: 12, borderRadius: "50%",
        background: dimmed ? "#C6C6C6" : bg,
        border: "0.5px solid rgba(0,0,0,0.18)",
        padding: 0, margin: 0, cursor: "default",
      }}
    />
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {dot("#FF5F57", "close", onClose)}
      {dot("#FEBC2E", "minimize")}
      {dot("#28C840", "zoom")}
    </div>
  );
};

function FMTitleBar({ title, modified, theme, onClose, viewMode, setViewMode, sidebarOpen, setSidebarOpen }) {
  const T = theme;
  return (
    <div
      className="fm-titlebar"
      style={{
        height: 44,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        background: T.titlebarBg,
        borderBottom: `0.5px solid ${T.titlebarBorder}`,
        userSelect: "none",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <FM_TRAFFIC onClose={onClose} />

      {/* Centered title */}
      <div
        style={{
          position: "absolute",
          left: 0, right: 0, top: 0, bottom: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--fm-ui)",
            fontSize: 13, fontWeight: 600,
            color: T.chromeText,
            letterSpacing: "-0.005em",
          }}
        >
          {modified && (
            <span
              aria-label="modified"
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: T.chromeFaint, marginRight: 2,
              }}
            />
          )}
          <span>{title}</span>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Right-side: view toggle + sidebar toggle */}
      <FMSegmented
        theme={T}
        value={viewMode}
        onChange={setViewMode}
        options={[
          { value: "rendered", label: "Rendered" },
          { value: "source", label: "Source" },
        ]}
      />
      <button
        className="fm-iconbtn"
        title={sidebarOpen ? "Hide comments" : "Show comments"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          width: 28, height: 24, borderRadius: 6,
          border: "none", background: "transparent",
          color: T.chromeMuted, padding: 0, cursor: "default",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" fill={sidebarOpen ? "currentColor" : "none"} fillOpacity={sidebarOpen ? 0.12 : 0} />
          <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  );
}

function FMSegmented({ theme, value, onChange, options }) {
  const T = theme;
  return (
    <div
      style={{
        display: "inline-flex",
        background: theme.name === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
        borderRadius: 7,
        padding: 2,
        gap: 0,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              fontFamily: "var(--fm-ui)",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              color: active ? T.chromeText : T.chromeMuted,
              padding: "3px 10px",
              border: "none",
              background: active
                ? (T.name === "dark" ? "#3F3F3F" : "#FFFFFF")
                : "transparent",
              borderRadius: 5,
              boxShadow: active
                ? (T.name === "dark"
                    ? "0 0 0 0.5px rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.35)"
                    : "0 0 0 0.5px rgba(0,0,0,0.06), 0 1px 1.5px rgba(0,0,0,0.10)")
                : "none",
              cursor: "default",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Sidebar header — filter/sort + count
function FMSidebarHeader({ theme, total, unresolved, filter, setFilter, sort, setSort, query, setQuery }) {
  const T = theme;
  return (
    <div
      style={{
        padding: "12px 14px 10px",
        borderBottom: `0.5px solid ${T.divider}`,
        display: "flex", flexDirection: "column", gap: 8,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap", flexWrap: "nowrap" }}>
        <span
          style={{
            fontFamily: "var(--fm-ui)",
            fontSize: 13, fontWeight: 600, color: T.chromeText,
            letterSpacing: "-0.005em",
          }}
        >
          Comments
        </span>
        <span
          style={{
            fontFamily: "var(--fm-ui)",
            fontSize: 12, color: T.chromeMuted,
            whiteSpace: "nowrap",
          }}
        >
          {unresolved} open · {total} total
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <FMSelect
          theme={T}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All comments" },
            { value: "open", label: "Open only" },
            { value: "resolved", label: "Resolved" },
            { value: "mine", label: "By me" },
            { value: "claude", label: "By Claude" },
          ]}
        />
        <div style={{ flex: 1 }} />
        <FMSelect
          theme={T}
          value={sort}
          onChange={setSort}
          compact
          options={[
            { value: "doc", label: "Doc order" },
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]}
        />
      </div>
    </div>
  );
}

function FMSelect({ theme, value, onChange, options, compact = false }) {
  const T = theme;
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          fontFamily: "var(--fm-ui)",
          fontSize: 12,
          color: T.chromeText,
          background: T.name === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          border: `0.5px solid ${T.divider}`,
          borderRadius: 6,
          padding: compact ? "3px 22px 3px 8px" : "4px 22px 4px 9px",
          cursor: "default",
          outline: "none",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg
        width="9" height="9" viewBox="0 0 9 9"
        style={{
          position: "absolute", right: 7, top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: T.chromeMuted,
        }}
      >
        <path d="M2 3.2 L4.5 5.7 L7 3.2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// Avatar — initials in a soft circle. AI agents use the same treatment per brief.
function FMAvatar({ name, theme, size = 22 }) {
  const T = theme;
  // Stable hue per author; chroma kept low so no avatar dominates.
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 47) % 360;
  const bg = T.name === "dark"
    ? `oklch(0.40 0.04 ${hue})`
    : `oklch(0.84 0.04 ${hue})`;
  const fg = T.name === "dark"
    ? `oklch(0.92 0.03 ${hue})`
    : `oklch(0.32 0.06 ${hue})`;
  const initials = name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: bg, color: fg,
        fontFamily: "var(--fm-ui)",
        fontSize: Math.round(size * 0.45), fontWeight: 600,
        letterSpacing: "0.01em",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initials}
    </div>
  );
}

Object.assign(window, { FMTitleBar, FMSegmented, FMSelect, FMSidebarHeader, FMAvatar });
