import { useEffect } from "react";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  checkForUpdate,
  dismissUpdate,
  downloadUpdate,
  openDownload,
  restartToUpdate,
  updateDismissed,
  useAppUpdate,
} from "../services/appUpdate";
import { useCheckForUpdates } from "../state/preferences";
import "./UpdateBanner.css";

// A strip under the tab bar when a newer Forgemark is out
// (`services/appUpdate.ts`). Update downloads it; Restart installs it
// after the unsaved-work prompt every quit gets. Where the app can't
// update itself, Download opens the release's file for this platform.
// "Later" hides it until a newer version than the one dismissed.
export function UpdateBanner() {
  const update = useAppUpdate();
  const [autoCheck] = useCheckForUpdates();

  useEffect(() => {
    if (!autoCheck) return;
    const first = window.setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
    const daily = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(daily);
    };
  }, [autoCheck]);

  if (update.kind === "available" && !updateDismissed(update.version)) {
    const { version, automatic } = update;
    return (
      <Strip>
        <span className="fm-update-banner-text">Forgemark {version} is available.</span>
        <span className="fm-update-banner-spacer" />
        <button type="button" className="fm-btn fm-btn-sm" onClick={() => dismissUpdate(version)}>
          Later
        </button>
        {automatic ? (
          <button
            type="button"
            className="fm-btn fm-btn-sm fm-btn-primary"
            data-testid="fm-update-install"
            onClick={() => void downloadUpdate()}
          >
            Update
          </button>
        ) : (
          <button
            type="button"
            className="fm-btn fm-btn-sm fm-btn-primary"
            data-testid="fm-update-download"
            onClick={() => void openDownload(version)}
          >
            Download
          </button>
        )}
      </Strip>
    );
  }

  if (update.kind === "downloading") {
    const pct = update.total
      ? Math.min(100, Math.round((update.received / update.total) * 100))
      : null;
    return (
      <Strip>
        <span className="fm-update-banner-text">
          Downloading Forgemark {update.version}
          {pct !== null ? ` — ${pct}%` : "…"}
        </span>
      </Strip>
    );
  }

  if (update.kind === "ready") {
    return (
      <Strip>
        <span className="fm-update-banner-text">
          Forgemark {update.version} is ready. Restart to finish updating.
        </span>
        <span className="fm-update-banner-spacer" />
        <button
          type="button"
          className="fm-btn fm-btn-sm fm-btn-primary"
          data-testid="fm-update-restart"
          onClick={restartToUpdate}
        >
          Restart
        </button>
      </Strip>
    );
  }

  // A failed update, not a failed check: those are reported in Settings,
  // where the reader asked.
  if (update.kind === "failed" && update.version) {
    const { version, message } = update;
    return (
      <Strip>
        <span className="fm-update-banner-text" title={message}>
          {`Forgemark ${version} couldn't be installed automatically: ${message}`}
        </span>
        <span className="fm-update-banner-spacer" />
        <button type="button" className="fm-btn fm-btn-sm" onClick={() => dismissUpdate(version)}>
          Later
        </button>
        <button
          type="button"
          className="fm-btn fm-btn-sm fm-btn-primary"
          data-testid="fm-update-download"
          onClick={() => void openDownload(version)}
        >
          Download
        </button>
      </Strip>
    );
  }

  return null;
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="fm-update-banner" role="status" data-testid="fm-update-banner">
      {children}
    </div>
  );
}
