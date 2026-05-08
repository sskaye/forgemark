import { useEffect, useRef, useState } from "react";
import { useAuthorName } from "../state/preferences";
import "./FirstRunWelcome.css";

type Props = {
  onSkip: () => void;
  onOpenSample: () => void;
};

// Phase 11 first-run onboarding (design v1.1 §8). Single screen with
// the Forgemark glyph, a name field, and two buttons. After either
// path, the parent marks the first-run flag done so this never shows
// again.
export function FirstRunWelcome({ onSkip, onOpenSample }: Props) {
  const [author, setAuthor] = useAuthorName();
  const [name, setName] = useState(author === "You" ? "" : author);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed.length > 0) setAuthor(trimmed);
  };

  return (
    <div className="fm-first-run" data-testid="fm-first-run">
      <div className="fm-first-run-card">
        <div className="fm-first-run-glyph" aria-hidden>
          {/* A simple geometric glyph — anvil / mark + spark. Using
              inline SVG so it scales cleanly with theme. */}
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="8" y="22" width="32" height="6" rx="2" fill="currentColor" />
            <path d="M14 22 L14 14 L22 14 L22 22 Z" fill="currentColor" opacity="0.6" />
            <circle cx="34" cy="14" r="3" fill="currentColor" opacity="0.4" />
          </svg>
        </div>
        <h1 className="fm-first-run-title">Welcome to Forgemark</h1>
        <p className="fm-first-run-sub">
          Markdown review for humans and AI agents working as peers.
        </p>
        <label className="fm-first-run-label" htmlFor="fm-first-run-name">
          Your name
        </label>
        <input
          ref={inputRef}
          id="fm-first-run-name"
          type="text"
          className="fm-first-run-input"
          placeholder="What should comments be signed?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          data-testid="fm-first-run-name"
        />
        <div className="fm-first-run-actions">
          <button
            type="button"
            className="fm-modal-button"
            onClick={() => {
              commitName();
              onSkip();
            }}
            data-testid="fm-first-run-skip"
          >
            Skip
          </button>
          <button
            type="button"
            className="fm-modal-button fm-modal-button-primary"
            onClick={() => {
              commitName();
              onOpenSample();
            }}
            data-testid="fm-first-run-open-sample"
          >
            Open sample →
          </button>
        </div>
      </div>
    </div>
  );
}
