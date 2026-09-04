import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { downloadSkill } from "../services/skillDownload";
import {
  SHIPPED,
  detectTargets,
  installSkill,
  skillStatus,
  type SkillStatus,
  type SkillTarget,
} from "../services/skillInstall";

// The rows of Settings → AI agents: one per tool on this machine, each
// with a glyph-and-words status and the one action it calls for. The
// glyph is always spelled out beside it, so a state never rests on
// colour alone; the version pair carries the message and the button
// carries the verb.

type Row = {
  target: SkillTarget;
  status: SkillStatus | null; // null while checking
  busy: boolean;
  justInstalled: boolean;
  error: string | null;
};

// Fired on the window after an install, so the launch notice can re-check.
export const SKILL_INSTALLED_EVENT = "forgemark:skill-installed";

export function SkillInstallRows() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let targets: SkillTarget[];
      try {
        targets = await detectTargets();
      } catch (err) {
        if (!cancelled) setDetectError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (cancelled) return;
      setRows(
        targets.map((target) => ({
          target,
          status: null,
          busy: false,
          justInstalled: false,
          error: null,
        })),
      );
      for (const target of targets) {
        const status = await skillStatus(target).catch(() => ({ kind: "absent" }) as SkillStatus);
        if (cancelled) return;
        setRows((rs) => rs && rs.map((r) => (r.target.id === target.id ? { ...r, status } : r)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((id: SkillTarget["id"], change: Partial<Row>) => {
    setRows((rs) => rs && rs.map((r) => (r.target.id === id ? { ...r, ...change } : r)));
  }, []);

  const install = useCallback(
    async (row: Row) => {
      patch(row.target.id, { busy: true, error: null });
      try {
        const status = await installSkill(row.target);
        patch(row.target.id, { status, busy: false, justInstalled: true });
        window.dispatchEvent(new CustomEvent(SKILL_INSTALLED_EVENT));
      } catch (err) {
        patch(row.target.id, {
          busy: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [patch],
  );

  const onSave = async () => {
    setSaveError(null);
    try {
      await downloadSkill("any");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fm-skill">
      <p className="fm-settings-ai-blurb">
        Forgemark ships a skill that teaches an agent to read and answer review comments with the
        app&rsquo;s own tool. Install it where your agents look.
      </p>
      <div className="fm-skill-rows" data-testid="fm-skill-rows">
        {detectError ? (
          <div
            className="fm-skill-row fm-skill-row--quiet"
            role="alert"
            data-testid="fm-skill-detect-error"
          >
            Couldn&rsquo;t look for agents on this Mac: {detectError}
          </div>
        ) : rows === null ? (
          <div className="fm-skill-row fm-skill-row--quiet">Looking for agents on this Mac…</div>
        ) : (
          rows.map((row) => (
            <SkillRow
              key={row.target.id}
              row={row}
              onInstall={() => install(row)}
              onReplace={() => setConfirming(row)}
            />
          ))
        )}
      </div>
      <div className="fm-skill-save">
        <button
          type="button"
          className="fm-btn fm-btn-sm fm-btn-quiet fm-skill-save-button"
          onClick={onSave}
          data-testid="fm-settings-skill-save"
        >
          Save skill file…
        </button>
        <span className="fm-settings-ai-help">For claude.ai in a browser, or another folder.</span>
      </div>
      {saveError && (
        <p className="fm-settings-ai-error" data-testid="fm-settings-skill-error" role="alert">
          {saveError}
        </p>
      )}
      {confirming && (
        <ReplaceConfirm
          row={confirming}
          onCancel={() => setConfirming(null)}
          onReplace={() => {
            const row = confirming;
            setConfirming(null);
            void install(row);
          }}
        />
      )}
    </div>
  );
}

function SkillRow({
  row,
  onInstall,
  onReplace,
}: {
  row: Row;
  onInstall: () => void;
  onReplace: () => void;
}) {
  const { target, status, busy, justInstalled, error } = row;
  const handoff = target.kind === "handoff";
  const sent = (s: SkillStatus) =>
    s.kind !== "absent" && s.kind !== "foreign" && s.sentAt
      ? ` · sent ${formatSent(s.sentAt)}`
      : "";

  let glyph: GlyphKind = "circle";
  let text: string;
  let button: { label: string; primary?: boolean; disabled?: boolean; onClick: () => void };
  if (error) {
    glyph = "bang";
    text = error;
    button = { label: "Retry", onClick: onInstall };
  } else if (busy) {
    glyph = "dots";
    text = "Installing…";
    button = { label: "Install", disabled: true, onClick: onInstall };
  } else if (status === null) {
    glyph = "dots";
    text = "Checking…";
    button = { label: "Install", disabled: true, onClick: onInstall };
  } else if (status.kind === "absent") {
    text = "Not installed";
    button = { label: "Install", onClick: onInstall };
  } else if (status.kind === "current") {
    glyph = "check";
    text =
      justInstalled && target.afterInstall
        ? `Installed ${status.version} · ${target.afterInstall}`
        : `Up to date${sent(status)}`;
    button = { label: "Update", disabled: true, onClick: onInstall };
  } else if (status.kind === "outdated") {
    glyph = "up";
    text = `${status.installed} → ${SHIPPED.version}${sent(status)}`;
    button = { label: "Update", primary: true, onClick: onInstall };
  } else {
    glyph = "bang";
    text = "Unrecognized folder";
    button = { label: "Replace…", onClick: onReplace };
  }
  const tone = error
    ? "danger"
    : glyph === "check"
      ? "ok"
      : glyph === "up"
        ? "accent"
        : glyph === "bang"
          ? "warn"
          : "muted";

  return (
    <div
      className="fm-skill-row"
      data-testid={`fm-skill-row-${target.id}`}
      data-state={error ? "error" : busy ? "busy" : (status?.kind ?? "checking")}
    >
      <div className="fm-skill-tool">{target.name}</div>
      <div
        className={`fm-skill-status fm-skill-status--${tone}`}
        data-testid={`fm-skill-status-${target.id}`}
      >
        <Glyph kind={glyph} />
        <span>{text}</span>
        {target.shownPath && !error && <span className="fm-skill-path">{target.shownPath}</span>}
      </div>
      <button
        type="button"
        className={`fm-btn${button.primary ? " fm-btn-primary" : ""}`}
        disabled={button.disabled}
        onClick={button.onClick}
        title={handoff ? "Opens the skill in the Claude app, which asks to install it." : undefined}
        data-testid={`fm-skill-action-${target.id}`}
      >
        {button.label}
      </button>
    </div>
  );
}

function ReplaceConfirm({
  row,
  onCancel,
  onReplace,
}: {
  row: Row;
  onCancel: () => void;
  onReplace: () => void;
}) {
  const status = row.status?.kind === "foreign" ? row.status : null;
  const folder = row.target.folder;
  const parent = folder.slice(0, folder.lastIndexOf("/"));
  return (
    <Modal
      labelledBy="fm-skill-replace-title"
      testId="fm-skill-replace"
      onClose={onCancel}
      width={420}
    >
      <header className="fm-modal-header">
        <h2 id="fm-skill-replace-title" className="fm-modal-title">
          Replace the folder?
        </h2>
      </header>
      <div className="fm-modal-body fm-skill-replace-body">
        <p>
          There is already a <code>forgemark</code> folder in <code>{tilde(parent)}</code> that
          Forgemark didn&rsquo;t write, or that has been changed since. Replacing it installs the
          skill this app ships and removes what is there now.
        </p>
        {status && (
          <p className="fm-settings-ai-help">
            The folder has {status.files} file{status.files === 1 ? "" : "s"}.
            {status.changed.length > 0 &&
              ` ${describeChanged(status.changed)} ${status.changed.length === 1 ? "differs" : "differ"} from any Forgemark build.`}
          </p>
        )}
      </div>
      <footer className="fm-modal-footer">
        <span className="fm-modal-spacer" />
        <button type="button" className="fm-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="fm-btn fm-btn-primary"
          onClick={onReplace}
          data-testid="fm-skill-replace-confirm"
        >
          Replace
        </button>
      </footer>
    </Modal>
  );
}

function describeChanged(paths: string[]): string {
  if (paths.length <= 2) return paths.map((p) => `“${p}”`).join(" and ");
  return `${paths.length} of them, ${paths
    .slice(0, 2)
    .map((p) => `“${p}”`)
    .join(" and ")} among them,`;
}

function tilde(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

// "today", "yesterday", or a short date, for when the skill was last
// handed to the Claude app.
export function formatSent(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "earlier";
  const day = (d: Date) =>
    Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const diff = day(now) - day(then);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

type GlyphKind = "check" | "up" | "circle" | "bang" | "dots";

function Glyph({ kind }: { kind: GlyphKind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "fm-skill-glyph",
  };
  switch (kind) {
    case "check":
      return (
        <svg {...common}>
          <path d="M2.5 6.5 5 9l4.5-6" />
        </svg>
      );
    case "up":
      return (
        <svg {...common}>
          <path d="M6 10V2.5M2.8 5.7 6 2.5l3.2 3.2" />
        </svg>
      );
    case "bang":
      return (
        <svg {...common}>
          <path d="M6 2.5v4.5" />
          <circle cx="6" cy="9.4" r="0.5" fill="currentColor" />
        </svg>
      );
    case "dots":
      return (
        <svg {...common}>
          <circle cx="2.5" cy="6" r="0.8" fill="currentColor" />
          <circle cx="6" cy="6" r="0.8" fill="currentColor" />
          <circle cx="9.5" cy="6" r="0.8" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" />
        </svg>
      );
  }
}
