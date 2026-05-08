import type { CSSProperties } from "react";
import "./Avatar.css";

type Props = {
  name: string;
  size?: number;
};

// Deterministic-color avatar. The hue is derived from the author name so
// "Claude" is always the same colour across files. Chroma stays low so no
// avatar dominates. AI authors get the same treatment as humans — design
// pillar #3.
export function Avatar({ name, size = 22 }: Props) {
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 47) % 360;
  const initials =
    name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.45),
    "--avatar-hue": String(hue),
  } as CSSProperties;
  return (
    <span className="fm-avatar" aria-hidden style={style}>
      {initials}
    </span>
  );
}
