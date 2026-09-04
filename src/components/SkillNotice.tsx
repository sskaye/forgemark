import { useEffect, useState } from "react";
import { SKILL_INSTALLED_EVENT } from "./SkillInstallRows";
import { anyInstallOutdated, dismissNotice, noticeDismissed } from "../services/skillInstall";
import "./SkillNotice.css";

// One line at the bottom of the sidebar, shown when an installed copy of
// the agent skill is behind the one this app ships. It only checks; the
// update is a click away in Settings, and never happens on its own. A
// dismissal lasts until the next Forgemark version, so a user who
// declines is not asked again about the same build.
export function SkillNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (noticeDismissed()) {
        setShow(false);
        return;
      }
      const outdated = await anyInstallOutdated().catch(() => false);
      if (!cancelled) setShow(outdated);
    };
    void check();
    window.addEventListener(SKILL_INSTALLED_EVENT, check);
    return () => {
      cancelled = true;
      window.removeEventListener(SKILL_INSTALLED_EVENT, check);
    };
  }, []);

  if (!show) return null;
  return (
    <div className="fm-skill-notice" data-testid="fm-skill-notice">
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="fm-skill-notice-glyph"
      >
        <path d="M6 10V2.5M2.8 5.7 6 2.5l3.2 3.2" />
      </svg>
      <span className="fm-skill-notice-text">
        Agent skill out of date ·{" "}
        <button
          type="button"
          className="fm-skill-notice-link"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("forgemark:menu", { detail: "install-skill" }))
          }
          data-testid="fm-skill-notice-update"
        >
          Update
        </button>
      </span>
      <button
        type="button"
        className="fm-skill-notice-dismiss"
        title="Hide until the next Forgemark update"
        aria-label="Hide until the next Forgemark update"
        onClick={() => {
          dismissNotice();
          setShow(false);
        }}
        data-testid="fm-skill-notice-dismiss"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  );
}
