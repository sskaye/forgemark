import { useEffect, useRef } from "react";
import "./ContextMenu.css";

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  testid?: string;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
};

// Lightweight floating menu used for the right-click affordance in
// the rendered editor. Dismisses on Esc, click-outside, scroll, or
// blur. Anchored at the click point in client-space pixels; flips
// to stay on-screen when near the viewport edge.
export function ContextMenu({ x, y, items, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    const onClickAway = (e: MouseEvent) => {
      const node = ref.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      onDismiss();
    };
    const onScroll = () => onDismiss();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickAway, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickAway, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  // Edge-flipping: measure after mount, nudge onto screen if needed.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.bottom > vh - 8) dy = vh - 8 - r.bottom;
    if (dx || dy) {
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }, []);

  return (
    <div
      ref={ref}
      className="fm-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      data-testid="fm-context-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className="fm-context-menu-item"
          onClick={() => {
            item.onSelect();
            onDismiss();
          }}
          data-testid={item.testid}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
