import "./Sidebar.css";

// Phase 1: empty sidebar with the header chrome (counts placeholder + filter
// + sort dropdowns). Cards arrive in Phase 4; the dynamic filter populates
// in Phase 6.
export function Sidebar() {
  return (
    <aside className="fm-sidebar" data-testid="fm-sidebar" aria-label="Comments">
      <SidebarHeader />
      <div className="fm-sidebar-body">{/* Empty in Phase 1 — see Phase 4 for cards */}</div>
    </aside>
  );
}

function SidebarHeader() {
  return (
    <div className="fm-sidebar-header">
      <div className="fm-sidebar-title-row">
        <span className="fm-sidebar-title">Comments</span>
        <span className="fm-sidebar-counts">0 open · 0 total</span>
      </div>
      <div className="fm-sidebar-controls">
        <select className="fm-select" aria-label="Filter comments" defaultValue="all">
          <option value="all">All comments</option>
          <option value="open">Open only</option>
          <option value="resolved">Resolved</option>
        </select>
        <div className="fm-spacer" />
        <select
          className="fm-select fm-select-compact"
          aria-label="Sort comments"
          defaultValue="doc"
        >
          <option value="doc">Doc order</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  );
}
