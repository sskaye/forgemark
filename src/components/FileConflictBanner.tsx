import "./FileConflictBanner.css";

type Props = {
  onKeepYours: () => void;
  onReloadFromDisk: () => void;
};

// Phase 10 file-conflict banner (design v1.1 §11a). Shows when the file
// has changed on disk but the user has no unsaved work — the choice is
// purely "do you want what's on disk, or what's already on screen?".
//
// Per v1.1 feedback §5: no `×` dismiss. The user picks one of the two
// buttons; "Keep your version" is the explicit-dismiss path.
export function FileConflictBanner({ onKeepYours, onReloadFromDisk }: Props) {
  return (
    <aside className="fm-conflict-banner" role="status" data-testid="fm-conflict-banner">
      <span className="fm-conflict-banner-icon" aria-hidden>
        ⟳
      </span>
      <span className="fm-conflict-banner-text">
        This file changed on disk while you were viewing it.
      </span>
      <div className="fm-conflict-banner-spacer" />
      <button
        type="button"
        className="fm-conflict-banner-button"
        onClick={onKeepYours}
        data-testid="fm-conflict-banner-keep"
      >
        Keep your version
      </button>
      <button
        type="button"
        className="fm-conflict-banner-button fm-conflict-banner-button-primary"
        onClick={onReloadFromDisk}
        data-testid="fm-conflict-banner-reload"
      >
        Reload from disk
      </button>
    </aside>
  );
}
