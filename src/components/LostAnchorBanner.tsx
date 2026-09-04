import "./LostAnchorBanner.css";

type Props = {
  count: number;
  onRecover: () => void;
  // How many of those anchors have an unambiguous match in the current
  // document. Zero hides the bulk action.
  confidentCount?: number;
  onReattachConfident?: () => void;
};

// Phase 9 banner. Sits at the top of the editor pane, above the prose
// (and above the source-view chip when both are visible — the chip's
// CSS reserves space below). Opens the Reattach modal for the first
// lost-anchor comment.
//
// The bulk action exists because of how HTML reports are actually used:
// they are regenerated rather than edited, so a rebuild orphans every
// anchor at once and the per-comment modal turns a mechanical recovery
// into a dozen identical decisions. Only unambiguous matches are offered
// this way; anything the ranking is unsure about still goes through the
// modal, where the reviewer can see what they're agreeing to.
export function LostAnchorBanner({
  count,
  onRecover,
  confidentCount = 0,
  onReattachConfident,
}: Props) {
  if (count <= 0) return null;
  const showBulk = confidentCount > 0 && onReattachConfident != null;
  return (
    <aside className="fm-lost-banner" role="status" data-testid="fm-lost-banner">
      <span className="fm-lost-banner-icon" aria-hidden>
        ⚠
      </span>
      <span className="fm-lost-banner-text">
        {count === 1 ? "1 comment lost its anchor." : `${count} comments lost their anchors.`}
      </span>
      <div className="fm-lost-banner-spacer" />
      {showBulk && (
        <button
          type="button"
          className="fm-btn fm-btn-sm fm-btn-primary fm-lost-banner-button"
          onClick={onReattachConfident}
          data-testid="fm-lost-banner-reattach-all"
        >
          {confidentCount === count
            ? `Reattach all ${count}`
            : `Reattach ${confidentCount} of ${count}`}
        </button>
      )}
      <button
        type="button"
        className={
          "fm-btn fm-btn-sm " +
          (showBulk ? "fm-lost-banner-button-secondary" : "fm-btn-primary fm-lost-banner-button")
        }
        onClick={onRecover}
        data-testid="fm-lost-banner-recover"
      >
        {showBulk ? "Review each…" : "Recover…"}
      </button>
    </aside>
  );
}
