import { useEffect, useRef } from "react";
import "./FindReplaceBar.css";

type Props = {
  query: string;
  replacement: string;
  replaceVisible: boolean;
  matchCount: number;
  activeIndex: number;
  readOnly: boolean;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onToggleReplace: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
};

export function FindReplaceBar({
  query,
  replacement,
  replaceVisible,
  matchCount,
  activeIndex,
  readOnly,
  onQueryChange,
  onReplacementChange,
  onToggleReplace,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
}: Props) {
  const findRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const target = replaceVisible ? replaceRef.current : findRef.current;
    target?.focus();
    target?.select();
  }, [replaceVisible]);

  const label =
    query.length === 0
      ? "No query"
      : matchCount === 0
        ? "No matches"
        : `${activeIndex + 1} of ${matchCount}`;
  const canReplace = !readOnly && query.length > 0 && matchCount > 0;

  const onFindKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    }
  };

  const onReplaceKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) onReplaceAll();
      else onReplace();
    }
  };

  return (
    <section className="fm-findbar" data-testid="fm-findbar" aria-label="Find and replace">
      <div className="fm-findbar-fields">
        <div className="fm-findbar-row">
          <input
            ref={findRef}
            className="fm-findbar-input"
            value={query}
            placeholder="Find"
            aria-label="Find"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onFindKeyDown}
            data-testid="fm-findbar-query"
          />
          <span className="fm-findbar-count" data-testid="fm-findbar-count">
            {label}
          </span>
        </div>
        {replaceVisible && (
          <div className="fm-findbar-row">
            <input
              ref={replaceRef}
              className="fm-findbar-input"
              value={replacement}
              placeholder="Replace"
              aria-label="Replacement text"
              onChange={(e) => onReplacementChange(e.target.value)}
              onKeyDown={onReplaceKeyDown}
              data-testid="fm-findbar-replacement"
            />
          </div>
        )}
      </div>
      <div className="fm-findbar-controls">
        <div className="fm-findbar-actions fm-findbar-nav-actions">
          <button
            type="button"
            className="fm-findbar-button"
            title="Previous match"
            aria-label="Previous match"
            onClick={onPrevious}
            disabled={matchCount === 0}
            data-testid="fm-findbar-prev"
          >
            ↑
          </button>
          <button
            type="button"
            className="fm-findbar-button"
            title="Next match"
            aria-label="Next match"
            onClick={onNext}
            disabled={matchCount === 0}
            data-testid="fm-findbar-next"
          >
            ↓
          </button>
          <button
            type="button"
            className="fm-findbar-button"
            title="Done"
            aria-label="Close find and replace"
            onClick={onClose}
            data-testid="fm-findbar-close"
          >
            ×
          </button>
        </div>
        {replaceVisible && (
          <div className="fm-findbar-actions fm-findbar-replace-actions">
            <button
              type="button"
              className="fm-findbar-text-button"
              onClick={onReplace}
              disabled={!canReplace}
              data-testid="fm-findbar-replace"
            >
              Replace
            </button>
            <button
              type="button"
              className="fm-findbar-text-button"
              onClick={onReplaceAll}
              disabled={!canReplace}
              data-testid="fm-findbar-replace-all"
            >
              All
            </button>
          </div>
        )}
        <label className="fm-findbar-replace-toggle">
          <input
            type="checkbox"
            checked={replaceVisible}
            onChange={onToggleReplace}
            data-testid="fm-findbar-toggle-replace"
          />
          <span>Replace</span>
        </label>
      </div>
    </section>
  );
}
