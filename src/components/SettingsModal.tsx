import { Modal } from "./Modal";
import { Segmented } from "./Segmented";
import { useEffect, useRef } from "react";
import {
  useAuthorName,
  useFontSize,
  useDefaultView,
  FONT_SIZE_RANGE,
  type ViewPreference,
} from "../state/preferences";
import { useTheme } from "../theme/ThemeProvider";
import { SkillInstallRows } from "./SkillInstallRows";
import "./SettingsModal.css";

type Props = {
  onClose: () => void;
};

// The Settings window, in the macOS Preferences shape. AI agents holds
// the skill install rows (SkillInstallRows).
export function SettingsModal({ onClose }: Props) {
  const [author, setAuthor] = useAuthorName();
  const { preference: theme, setPreference: setTheme } = useTheme();
  const [fontSize, setFontSize] = useFontSize();
  const [defaultView, setDefaultView] = useDefaultView();
  const authorRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    authorRef.current?.focus();
  }, []);

  return (
    <Modal
      labelledBy="fm-settings-title"
      testId="fm-settings-modal"
      onClose={onClose}
      contentClassName="fm-settings"
    >
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
                className="fm-btn fm-btn-sm fm-settings-stepper-btn"
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
                className="fm-btn fm-btn-sm fm-settings-stepper-btn"
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

        <Section title="AI agents">
          <SkillInstallRows />
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
          className="fm-btn fm-btn-primary"
          onClick={onClose}
          data-testid="fm-settings-done"
        >
          Done
        </button>
      </footer>
    </Modal>
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
