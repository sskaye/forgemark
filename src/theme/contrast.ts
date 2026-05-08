// WCAG AA contrast computation. Used by tests/unit/contrast.test.ts to
// guard against token regressions. Implemented inline rather than via a
// dependency so the library surface stays small.
//
// Reference: https://www.w3.org/TR/WCAG21/#contrast-minimum
//
// AA thresholds:
//   - normal text:  4.5:1
//   - large text:   3:1
//   - UI components and large text:  3:1

export type RGBA = { r: number; g: number; b: number; a: number };

// Parse hex (#RGB, #RRGGBB) or rgb()/rgba() into RGBA with channels in
// 0–255 and alpha in 0–1. Throws on unrecognised input.
export function parseColor(input: string): RGBA {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    throw new Error(`Unsupported hex colour: ${input}`);
  }
  const m = trimmed.match(
    /^rgba?\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*(?:,\s*([-\d.]+)\s*)?\)$/i,
  );
  if (m) {
    return {
      r: clamp(Number(m[1]), 0, 255),
      g: clamp(Number(m[2]), 0, 255),
      b: clamp(Number(m[3]), 0, 255),
      a: m[4] === undefined ? 1 : clamp(Number(m[4]), 0, 1),
    };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

// Composite a foreground colour with alpha over an opaque background.
// Returns the resulting opaque RGB.
export function compositeOver(fg: RGBA, bg: { r: number; g: number; b: number; a?: number }): RGBA {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

// sRGB-relative luminance per WCAG. Channel values in 0–255.
export function relativeLuminance(c: RGBA): number {
  const linearise = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearise(c.r) + 0.7152 * linearise(c.g) + 0.0722 * linearise(c.b);
}

// Contrast ratio per WCAG. Ratio is always ≥ 1; a result of 1 means the
// two colours are identical.
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const fgOpaque = fg.a < 1 ? compositeOver(fg, bg) : fg;
  const bgOpaque = bg.a < 1 ? compositeOver(bg, { r: 255, g: 255, b: 255 }) : bg;
  const L1 = relativeLuminance(fgOpaque);
  const L2 = relativeLuminance(bgOpaque);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Convenience for the test: contrastRatio with string inputs.
export function contrast(fg: string, bg: string): number {
  return contrastRatio(parseColor(fg), parseColor(bg));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
