import { useRef, type KeyboardEvent } from "react";

// A segmented control: a row of exclusive options. Used for the
// Rendered / Source switch in the title bar (a tablist: it switches
// panes) and for Settings choices (a radiogroup). Two copies of this
// markup used to exist with different ARIA and no arrow keys; this one
// moves with ←/→ and Home/End and keeps a single tab stop.

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  role?: "tablist" | "radiogroup";
  // Accessible name of the group.
  label?: string;
  testid?: string;
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  role = "radiogroup",
  label,
  testid,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRole = role === "tablist" ? "tab" : "radio";

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (at + 1) % options.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (at - 1 + options.length) % options.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to].value);
    rootRef.current?.querySelectorAll<HTMLButtonElement>("button")[to]?.focus();
  };

  return (
    <div ref={rootRef} className="fm-segmented" role={role} aria-label={label} data-testid={testid}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role={itemRole}
            {...(itemRole === "tab" ? { "aria-selected": active } : { "aria-checked": active })}
            tabIndex={active ? 0 : -1}
            className={"fm-segmented-button" + (active ? " is-active" : "")}
            onClick={() => onChange(opt.value)}
            onKeyDown={onKeyDown}
            data-testid={testid ? `${testid}-${opt.value}` : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
