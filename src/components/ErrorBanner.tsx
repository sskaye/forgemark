import { useDocument } from "../state/DocumentProvider";
import "./ErrorBanner.css";

// Phase 2 minimum-viable error surface. Renders a magenta strip below the
// title bar with the most recent file-IO error and a dismiss × button.
// Phase 10's conflict surfaces and Phase 11's polish replace this with
// proper banners and modals.
export function ErrorBanner() {
  const { state, dispatch } = useDocument();
  if (!state.error) return null;
  return (
    <div className="fm-error-banner" role="alert" data-testid="fm-error-banner">
      <span className="fm-error-banner-message">{state.error}</span>
      <button
        type="button"
        className="fm-error-banner-dismiss"
        aria-label="Dismiss error"
        onClick={() => dispatch({ type: "dismissError" })}
      >
        ×
      </button>
    </div>
  );
}
