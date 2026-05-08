import { useEffect, useRef, useState } from "react";
import {
  useAuthorName,
  useFontSize,
  useDefaultView,
  FONT_SIZE_RANGE,
  type ViewPreference,
} from "../state/preferences";
import { useTheme } from "../theme/ThemeProvider";
import { downloadSkill } from "../services/skillDownload";
import "./SettingsModal.css";

type Props = {
  onClose: () => void;
};

// Phase 11 + 12 Settings window. AI Participation now ships the two
// skill-download buttons (Phase 12); the rest of the layout is the
// macOS Preferences shape from Phase 11.
export function SettingsModal({ onClose }: Props) {
  const [author, setAuthor] = useAuthorName();
  const { preference: theme, setPreference: setTheme } = useTheme();
  const [fontSize, setFontSize] = useFontSize();
  const [defaultView, setDefaultView] = useDefaultView();
  const authorRef = useRef<HTMLInputElement | null>(null);
  // Tracks which download button is in flight so we can disable
  // both while a save dialog is open and surface a transient error.
  const [downloadState, setDownloadState] = useState<{
    inFlight: "claude" | "codex" | null;
    error: string | null;
  }>({ inFlight: null, error: null });

  const onDownload = async (target: "claude" | "codex") => {
    setDownloadState({ inFlight: target, error: null });
    try {
      await downloadSkill(target);
      setDownloadState({ inFlight: null, error: null });
    } catch (err) {
      setDownloadState({
        inFlight: null,
        error: (err as Error).message ?? "Download failed",
      });
    }
  };

  useEffect(() => {
    authorRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-settings-title"
      data-testid="fm-settings-modal"
      onClick={onClose}
    >
      <div className="fm-settings" role="document" onClick={(e) => e.stopPropagation()}>
        <header className="fm-settings-header">
          <h2 id="fm-settings-title" className="fm-settings-title">
            Settings
          </h2>
        </header>
        <div className="fm-settings-body">
          <Section title="General">
            <Field label="Author name" htmlFor="fm-author">
              <input
                ref={authorRef}
                id="fm-author"
                type="text"
                className="fm-settings-input"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                data-testid="fm-settings-author"
              />
            </Field>
            <Field label="Theme">
              <Segmented
                testid="fm-settings-theme"
                value={theme}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
                onChange={(v) => setTheme(v as "light" | "dark" | "system")}
              />
            </Field>
            <Field label="Font size">
              <div className="fm-settings-stepper">
                <button
                  type="button"
                  className="fm-settings-stepper-btn"
                  onClick={() => setFontSize(fontSize - 1)}
                  disabled={fontSize <= FONT_SIZE_RANGE.min}
                  aria-label="Decrease text size"
                  data-testid="fm-settings-font-down"
                >
                  −
                </button>
                <span className="fm-settings-stepper-value" data-testid="fm-settings-font-value">
                  {fontSize}
                </span>
                <button
                  type="button"
                  className="fm-settings-stepper-btn"
                  onClick={() => setFontSize(fontSize + 1)}
                  disabled={fontSize >= FONT_SIZE_RANGE.max}
                  aria-label="Increase text size"
                  data-testid="fm-settings-font-up"
                >
                  +
                </button>
              </div>
            </Field>
            <Field label="Default view" hint="Applies to the next opened document.">
              <Segmented
                testid="fm-settings-default-view"
                value={defaultView}
                options={[
                  { value: "rendered", label: "Rendered" },
                  { value: "source", label: "Source" },
                ]}
                onChange={(v) => setDefaultView(v as ViewPreference)}
              />
            </Field>
          </Section>

          <Section title="AI Participation">
            <p className="fm-settings-ai-blurb">
              Forgemark ships a small skill bundle that teaches an AI agent how to read and write
              Forgemark files. Pick the artifact your tool expects:
            </p>
            <div className="fm-settings-ai-buttons">
              <button
                type="button"
                className="fm-modal-button fm-modal-button-primary"
                onClick={() => onDownload("claude")}
                disabled={downloadState.inFlight !== null}
                data-testid="fm-settings-skill-claude"
              >
                {downloadState.inFlight === "claude" ? "Saving…" : "Download for Claude (.skill)"}
              </button>
              <button
                type="button"
                className="fm-modal-button fm-modal-button-primary"
                onClick={() => onDownload("codex")}
                disabled={downloadState.inFlight !== null}
                data-testid="fm-settings-skill-codex"
              >
                {downloadState.inFlight === "codex" ? "Saving…" : "Download for Codex (.zip)"}
              </button>
            </div>
            <p className="fm-settings-ai-help">
              Both files contain identical content; the extension is what your AI tool expects.
            </p>
            {downloadState.error && (
              <p
                className="fm-settings-ai-error"
                data-testid="fm-settings-skill-error"
                role="alert"
              >
                {downloadState.error}
              </p>
            )}
          </Section>

          <Section title="About">
            <p className="fm-settings-about">
              Forgemark — collaborative review of markdown documents. Built with Tauri.
            </p>
          </Section>
        </div>
        <footer className="fm-settings-footer">
          <button
            type="button"
            className="fm-modal-button fm-modal-button-primary"
            onClick={onClose}
            data-testid="fm-settings-done"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fm-settings-section">
      <h3 className="fm-settings-section-title">{title}</h3>
      <div className="fm-settings-section-body">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fm-settings-field">
      <label className="fm-settings-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="fm-settings-field-control">
        {children}
        {hint && <span className="fm-settings-field-hint">{hint}</span>}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testid,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testid: string;
}) {
  return (
    <div className="fm-segmented" role="radiogroup" data-testid={testid}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={"fm-segmented-button" + (active ? " is-active" : "")}
            onClick={() => onChange(opt.value)}
            data-testid={`${testid}-${opt.value}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
