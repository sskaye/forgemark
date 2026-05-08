import "./LostAnchorBanner.css";

type Props = {
  count: number;
  onRecover: () => void;
};

// Phase 9 banner. Sits at the top of the editor pane, above the prose
// (and above the source-view chip when both are visible — the chip's
// CSS reserves space below). Single CTA: open the Reattach modal for
// the first lost-anchor comment.
export function LostAnchorBanner({ count, onRecover }: Props) {
  if (count <= 0) return null;
  return (
    <aside className="fm-lost-banner" role="status" data-testid="fm-lost-banner">
      <span className="fm-lost-banner-icon" aria-hidden>
        ⚠
      </span>
      <span className="fm-lost-banner-text">
        {count === 1 ? "1 comment lost its anchor." : `${count} comments lost their anchors.`}
      </span>
      <div className="fm-lost-banner-spacer" />
      <button
        type="button"
        className="fm-lost-banner-button"
        onClick={onRecover}
        data-testid="fm-lost-banner-recover"
      >
        Recover…
      </button>
    </aside>
  );
}
