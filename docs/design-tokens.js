// design-tokens.js — Forgemark design token source snapshot
// -----------------------------------------------------------------------------
// This file is retained for the token contract test. Production consumes the
// TypeScript translation in src/theme/tokens.ts; keep the values in sync.
// -----------------------------------------------------------------------------
// Light + dark themes. The Native type pairing is locked for v1; the Editorial
// pairing is commented below (considered, not shipped) — kept for context only.
// Accent follows macOS system blue by default. In production, Tauri exposes
// the user's chosen system accent; substitute it for `accent`/`accentSoft`
// (with a fallback to system blue if unavailable).

window.FM_TOKENS = (() => {
  const SYSTEM_SANS =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif';
  const SYSTEM_DISPLAY =
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro", "Helvetica Neue", Arial, sans-serif';
  const SYSTEM_MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

  // Charter is shipped with macOS; iowan is on iOS. Fall back gracefully.
  const HUMANIST_SERIF =
    '"Charter", "Iowan Old Style", "Palatino Linotype", Palatino, "Georgia", serif';

  const TYPE_PAIRINGS = {
    // LOCKED FOR v1 — Native: SF for chrome, SF Mono for source.
    // Closest to "feels like macOS".
    native: {
      label: "Native",
      sublabel: "SF Pro · SF Mono",
      ui: SYSTEM_SANS,
      uiDisplay: SYSTEM_DISPLAY,
      prose: SYSTEM_DISPLAY, // SF Pro Display reads beautifully at large sizes
      mono: SYSTEM_MONO,
      // Per-element tweaks
      proseLeading: 1.55,
      proseLetterSpacing: "-0.005em",
      uiLetterSpacing: "0",
    },
    // ---------------------------------------------------------------------------
    // CONSIDERED, NOT SHIPPED — Editorial pairing (Charter prose + SF chrome).
    // Kept here only as design archaeology; do NOT wire to user-facing controls.
    // The prototype's Tweaks panel ships the Native pairing only. If you want
    // to revisit this in v1.1, uncomment the block below and rewire the picker.
    //
    // editorial: {
    //   label: "Editorial",
    //   sublabel: "Charter · SF Pro",
    //   ui: SYSTEM_SANS,
    //   uiDisplay: SYSTEM_DISPLAY,
    //   prose: HUMANIST_SERIF,
    //   mono: SYSTEM_MONO,
    //   proseLeading: 1.6,
    //   proseLetterSpacing: "0",
    //   uiLetterSpacing: "0",
    // },
    // ---------------------------------------------------------------------------
  };
  // (HUMANIST_SERIF is intentionally retained above for the commented pairing.)

  // Color tokens. Light is the canonical theme; dark is a peer, not a retrofit.
  // Note: chroma kept low across the palette — we earn color with the accent.
  const LIGHT = {
    name: "light",
    // Window
    windowBg: "#ECECEC", // behind window
    titlebarBg: "#E8E8E6", // top chrome
    titlebarBorder: "rgba(0,0,0,0.10)",
    chromeText: "rgba(0,0,0,0.78)",
    chromeMuted: "rgba(0,0,0,0.50)",
    chromeFaint: "rgba(0,0,0,0.30)",
    divider: "rgba(0,0,0,0.08)",
    dividerStrong: "rgba(0,0,0,0.14)",
    // Editor
    editorBg: "#FCFCFB",
    editorPaper: "#FCFCFB",
    proseInk: "#1B1B1A",
    proseMuted: "rgba(27,27,26,0.62)",
    proseFaint: "rgba(27,27,26,0.40)",
    rule: "rgba(0,0,0,0.10)",
    code: "rgba(0,0,0,0.045)",
    codeBorder: "rgba(0,0,0,0.08)",
    // Sidebar
    sidebarBg: "#F4F3F0",
    cardBg: "#FFFFFF",
    cardBgElevated: "#FFFFFF",
    cardBorder: "rgba(0,0,0,0.08)",
    cardBorderFocused: "rgba(0,0,0,0.18)",
    cardShadow: "0 1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.04)",
    cardShadowFocused: "0 1px 0 rgba(0,0,0,0.06), 0 6px 18px rgba(0,0,0,0.10)",
    // Anchor (highlight) — yellow-ish, very subtle
    anchorBg: "rgba(255,200,72,0.22)",
    anchorBgHover: "rgba(255,200,72,0.38)",
    anchorBgFocus: "rgba(255,200,72,0.55)",
    anchorBgResolved: "rgba(0,0,0,0.05)",
    anchorUnderline: "rgba(180,130,0,0.55)",
    // Suggestion green (a touch warmer than sys green)
    suggestBg: "rgba(60,170,90,0.10)",
    suggestBgFocus: "rgba(60,170,90,0.20)",
    suggestText: "#1F8A5B",
    suggestStroke: "rgba(60,170,90,0.45)",
    // Orphaned (questioned) — dashed, magenta-ish so it's distinct from anchor + suggestion
    orphanBg: "transparent",
    orphanUnderline: "rgba(168,85,170,0.85)",
    orphanText: "#A055A8",
    // Accent — macOS system blue
    accent: "#0A84FF",
    accentHover: "#1F8FFF",
    accentText: "#FFFFFF",
    accentSoft: "rgba(10,132,255,0.10)",
    accentSoftStrong: "rgba(10,132,255,0.18)",
    // Feedback
    danger: "#D70015",
    success: "#1F8A5B",
    // Selection
    textSelection: "rgba(10,132,255,0.18)",
  };

  const DARK = {
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

  return {
    pairings: TYPE_PAIRINGS,
    themes: { light: LIGHT, dark: DARK },
  };
})();
