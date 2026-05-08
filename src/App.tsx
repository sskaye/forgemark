import "./App.css";

// Phase 0 placeholder. The real app shell, theme tokens, and chrome land
// in Phase 1. This component exists only so the smoke E2E (Tauri window
// opens without console errors, title bar reads "Forgemark — Untitled")
// passes.
export default function App() {
  return (
    <main className="fm-bootstrap">
      <h1>Forgemark</h1>
      <p>Phase 0 bootstrap. Real UI lands in Phase 1.</p>
    </main>
  );
}
