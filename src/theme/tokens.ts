// Forgemark design tokens — TypeScript translation of the retained
// `docs/design-tokens.js` source snapshot. Values must match the source
// byte-for-byte; the contract test in `tests/unit/tokens.test.ts` enforces
// this.
//
// In the prototype the design ships a Native and an Editorial type pairing.
// The Editorial pairing is commented out in the source as "considered, not
// shipped"; we keep only Native in the v1 build.

export const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif';
export const SYSTEM_DISPLAY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", "Helvetica Neue", Arial, sans-serif';
export const SYSTEM_MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

export type TypePairing = {
  label: string;
  sublabel: string;
  ui: string;
  uiDisplay: string;
  prose: string;
  mono: string;
  proseLeading: number;
  proseLetterSpacing: string;
  uiLetterSpacing: string;
};

export const TYPE_PAIRING_NATIVE: TypePairing = {
  label: "Native",
  sublabel: "SF Pro · SF Mono",
  ui: SYSTEM_SANS,
  uiDisplay: SYSTEM_DISPLAY,
  prose: SYSTEM_DISPLAY,
  mono: SYSTEM_MONO,
  proseLeading: 1.55,
  proseLetterSpacing: "-0.005em",
  uiLetterSpacing: "0",
};

// Theme is the full set of color tokens for a single mode. Light is
// canonical; Dark is a peer.
export type Theme = {
  name: "light" | "dark";

  // Window / chrome
  windowBg: string;
  titlebarBg: string;
  titlebarBorder: string;
  chromeText: string;
  chromeMuted: string;
  chromeFaint: string;
  divider: string;
  dividerStrong: string;

  // Editor pane
  editorBg: string;
  editorPaper: string;
  proseInk: string;
  proseMuted: string;
  proseFaint: string;
  rule: string;
  code: string;
  codeBorder: string;

  // Sidebar / cards
  sidebarBg: string;
  cardBg: string;
  cardBgElevated: string;
  cardBorder: string;
  cardBorderFocused: string;
  cardShadow: string;
  cardShadowFocused: string;

  // Anchors / highlights
  anchorBg: string;
  anchorBgHover: string;
  anchorBgFocus: string;
  anchorBgResolved: string;
  anchorUnderline: string;

  // Suggestions
  suggestBg: string;
  suggestBgFocus: string;
  suggestText: string;
  suggestStroke: string;

  // Lost anchor (orphan)
  orphanBg: string;
  orphanUnderline: string;
  orphanText: string;

  // Accent (system blue)
  accent: string;
  accentHover: string;
  accentText: string;
  accentSoft: string;
  accentSoftStrong: string;

  // Feedback
  danger: string;
  success: string;

  // Selection
  textSelection: string;
};

export const LIGHT: Theme = {
  name: "light",

  windowBg: "#ECECEC",
  titlebarBg: "#E8E8E6",
  titlebarBorder: "rgba(0,0,0,0.10)",
  chromeText: "rgba(0,0,0,0.78)",
  chromeMuted: "rgba(0,0,0,0.50)",
  chromeFaint: "rgba(0,0,0,0.30)",
  divider: "rgba(0,0,0,0.08)",
  dividerStrong: "rgba(0,0,0,0.14)",

  editorBg: "#FCFCFB",
  editorPaper: "#FCFCFB",
  proseInk: "#1B1B1A",
  proseMuted: "rgba(27,27,26,0.62)",
  proseFaint: "rgba(27,27,26,0.40)",
  rule: "rgba(0,0,0,0.10)",
  code: "rgba(0,0,0,0.045)",
  codeBorder: "rgba(0,0,0,0.08)",

  sidebarBg: "#F4F3F0",
  cardBg: "#FFFFFF",
  cardBgElevated: "#FFFFFF",
  cardBorder: "rgba(0,0,0,0.08)",
  cardBorderFocused: "rgba(0,0,0,0.18)",
  cardShadow: "0 1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.04)",
  cardShadowFocused: "0 1px 0 rgba(0,0,0,0.06), 0 6px 18px rgba(0,0,0,0.10)",

  anchorBg: "rgba(255,200,72,0.22)",
  anchorBgHover: "rgba(255,200,72,0.38)",
  anchorBgFocus: "rgba(255,200,72,0.55)",
  anchorBgResolved: "rgba(0,0,0,0.05)",
  anchorUnderline: "rgba(180,130,0,0.55)",

  suggestBg: "rgba(60,170,90,0.10)",
  suggestBgFocus: "rgba(60,170,90,0.20)",
  suggestText: "#1F8A5B",
  suggestStroke: "rgba(60,170,90,0.45)",

  orphanBg: "transparent",
  orphanUnderline: "rgba(168,85,170,0.85)",
  orphanText: "#A055A8",

  accent: "#0A84FF",
  accentHover: "#1F8FFF",
  accentText: "#FFFFFF",
  accentSoft: "rgba(10,132,255,0.10)",
  accentSoftStrong: "rgba(10,132,255,0.18)",

  danger: "#D70015",
  success: "#1F8A5B",

  textSelection: "rgba(10,132,255,0.18)",
};

export const DARK: Theme = {
  name: "dark",

  windowBg: "#1B1B1B",
  titlebarBg: "#2A2A2A",
  titlebarBorder: "rgba(255,255,255,0.08)",
  chromeText: "rgba(255,255,255,0.86)",
  chromeMuted: "rgba(255,255,255,0.55)",
  chromeFaint: "rgba(255,255,255,0.32)",
  divider: "rgba(255,255,255,0.07)",
  dividerStrong: "rgba(255,255,255,0.14)",

  editorBg: "#1F1F1F",
  editorPaper: "#1F1F1F",
  proseInk: "#ECECEC",
  proseMuted: "rgba(236,236,236,0.62)",
  proseFaint: "rgba(236,236,236,0.40)",
  rule: "rgba(255,255,255,0.10)",
  code: "rgba(255,255,255,0.06)",
  codeBorder: "rgba(255,255,255,0.10)",

  sidebarBg: "#262626",
  cardBg: "#2D2D2D",
  cardBgElevated: "#333333",
  cardBorder: "rgba(255,255,255,0.08)",
  cardBorderFocused: "rgba(255,255,255,0.18)",
  cardShadow: "0 1px 0 rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.4)",
  cardShadowFocused: "0 1px 0 rgba(0,0,0,0.5), 0 8px 22px rgba(0,0,0,0.55)",

  anchorBg: "rgba(255,200,72,0.16)",
  anchorBgHover: "rgba(255,200,72,0.26)",
  anchorBgFocus: "rgba(255,200,72,0.40)",
  anchorBgResolved: "rgba(255,255,255,0.05)",
  anchorUnderline: "rgba(255,200,72,0.65)",

  suggestBg: "rgba(60,200,120,0.14)",
  suggestBgFocus: "rgba(60,200,120,0.26)",
  suggestText: "#5FCB8B",
  suggestStroke: "rgba(60,200,120,0.50)",

  orphanBg: "transparent",
  orphanUnderline: "rgba(220,140,225,0.85)",
  orphanText: "#D599DA",

  accent: "#0A84FF",
  accentHover: "#3998FF",
  accentText: "#FFFFFF",
  accentSoft: "rgba(10,132,255,0.18)",
  accentSoftStrong: "rgba(10,132,255,0.30)",

  danger: "#FF453A",
  success: "#30D158",

  textSelection: "rgba(10,132,255,0.30)",
};

export const THEMES: Record<"light" | "dark", Theme> = { light: LIGHT, dark: DARK };

// Layout constants — pulled from the design handoff README §Spacing & radii.
// Locked for v1.
export const LAYOUT = {
  chromeHeight: 44, // titlebar + toolbar combined
  sidebarWidth: 320, // fixed
  documentMaxWidth: 720, // centered inside the editor pane
  editorPadding: { vertical: 32, horizontal: 48 },
  cardPadding: { vertical: 12, horizontal: 14 },
  cardGap: 10,
  cardRadius: 8,
  buttonRadius: 6,
  modalRadius: 10,
  hairline: 0.5,
} as const;

// Map a Theme onto CSS custom-property declarations. The mapping converts
// camelCase keys to kebab-case and prefixes with `--fm-`. The README in the
// design handoff lists this mapping authoritatively.
export function themeToCssVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (key === "name") continue;
    const cssName = "--fm-" + camelToKebab(key);
    out[cssName] = String(value);
  }
  return out;
}

// Type-pairing variables consumed by `var(--fm-ui)`, `var(--fm-prose)`,
// `var(--fm-mono)`, etc.
export function pairingToCssVars(p: TypePairing): Record<string, string> {
  return {
    "--fm-ui": p.ui,
    "--fm-ui-display": p.uiDisplay,
    "--fm-prose": p.prose,
    "--fm-mono": p.mono,
    "--fm-prose-leading": String(p.proseLeading),
    "--fm-prose-letterspacing": p.proseLetterSpacing,
    "--fm-ui-letterspacing": p.uiLetterSpacing,
  };
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}
