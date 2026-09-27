import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DOCUMENT_WIDTH_RANGE, clampDocumentWidth, type DocumentWidth } from "../state/preferences";
import {
  endDocumentWidthPreview,
  previewDocumentWidth,
  useDocumentWidthPreview,
} from "../services/documentWidth";

type Props = {
  width: DocumentWidth;
  onCommit: (width: DocumentWidth) => void;
  // HTML reports set their own width.
  disabled?: boolean;
};

const { min, max } = DOCUMENT_WIDTH_RANGE;
// The slider's last stop, one past the widest measure, is Full.
const FULL_STOP = max + 1;
// Scrubbing the number: pixels of pointer travel per character.
const SCRUB_PX = 2;

const toStop = (w: DocumentWidth) => (w === "full" ? FULL_STOP : w);
const fromStop = (n: number): DocumentWidth => (n >= FULL_STOP ? "full" : clampDocumentWidth(n));
const label = (w: DocumentWidth) => (w === "full" ? "Full" : String(w));

// The document width, beside the Rendered / Source switch: a slider,
// and its value, which can be clicked to type a number or dragged
// sideways to scrub. Widths are in average characters of the prose font;
// the far end of the slider is Full, the column filling the pane.
// Double-clicking the slider goes back to the default.
export function WidthControl({ width, onCommit, disabled = false }: Props) {
  const preview = useDocumentWidthPreview();
  const shown = preview ?? width;
  const sliderRef = useRef<HTMLInputElement>(null);

  const commit = (next: DocumentWidth) => {
    onCommit(next);
    endDocumentWidthPreview();
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // The native `change` fires once, when the slider is let go or a key
  // steps it; React's onChange fires on every move, which only previews.
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const onChange = () => commitRef.current(fromStop(Number(el.value)));
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      className="fm-width"
      data-testid="fm-width"
      aria-disabled={disabled || undefined}
      title={disabled ? "HTML reports set their own width" : "Document width, in characters"}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M1.5 2v10M12.5 2v10M4 7h6M4 7l1.8-1.8M4 7l1.8 1.8M10 7L8.2 5.2M10 7L8.2 8.8"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <input
        ref={sliderRef}
        type="range"
        className="fm-width-slider"
        data-testid="fm-width-slider"
        min={min}
        max={FULL_STOP}
        step={1}
        value={toStop(shown)}
        disabled={disabled}
        aria-label="Document width"
        aria-valuetext={shown === "full" ? "Full width" : `${shown} characters`}
        onChange={(e) => previewDocumentWidth(fromStop(Number(e.target.value)))}
        onDoubleClick={() => commit(DOCUMENT_WIDTH_RANGE.default)}
      />
      <WidthValue width={shown} disabled={disabled} onCommit={commit} />
    </div>
  );
}

// The number: click to type, drag sideways to scrub, arrow keys to step.
function WidthValue({
  width,
  disabled,
  onCommit,
}: {
  width: DocumentWidth;
  disabled: boolean;
  onCommit: (w: DocumentWidth) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrub = useRef<{ x: number; start: number; latest: DocumentWidth; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setText(label(width));
    setEditing(true);
  };

  const finishEditing = (keep: boolean) => {
    setEditing(false);
    if (!keep) return;
    const typed = parseTyped(text);
    if (typed !== null) onCommit(typed);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Scrubbing from Full starts at the widest measure.
    scrub.current = { x: e.clientX, start: toStop(width), latest: width, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) < 3) return;
    s.moved = true;
    document.body.dataset.widthScrubbing = "true";
    const next = fromStop(Math.max(min, Math.min(FULL_STOP, s.start + Math.round(dx / SCRUB_PX))));
    if (next !== s.latest) {
      s.latest = next;
      previewDocumentWidth(next);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = scrub.current;
    if (!s) return;
    scrub.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    delete document.body.dataset.widthScrubbing;
    if (s.moved) onCommit(s.latest);
    else startEditing();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const at = toStop(width);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = at + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = at - step;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startEditing();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    onCommit(fromStop(Math.max(min, Math.min(FULL_STOP, next))));
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="fm-width-value fm-width-input"
        data-testid="fm-width-input"
        aria-label="Document width in characters, or Full"
        value={text}
        size={4}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finishEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finishEditing(true);
          else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finishEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="fm-width-value"
      data-testid="fm-width-value"
      disabled={disabled}
      aria-label={`Document width: ${width === "full" ? "full" : width + " characters"}. Click to type, drag to change.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {label(width)}
    </button>
  );
}

// What was typed: a number of characters, clamped, or "full" (or any
// start of it). Anything else leaves the width as it was.
export function parseTyped(text: string): DocumentWidth | null {
  const t = text.trim().toLowerCase();
  if (t === "") return null;
  if ("full".startsWith(t)) return "full";
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n > max ? "full" : clampDocumentWidth(n);
}
