// design-system-canvas.jsx — Forgemark design system canvas.
// Loads the prototype's components (chrome, comment-card, sample-doc) and
// composes artboards covering: brand, type, color, highlight states,
// card states, suggested edits, secondary screens, dark theme.

const T_LIGHT = window.FM_TOKENS.themes.light;
const T_DARK = window.FM_TOKENS.themes.dark;

// Wrapper that injects the same CSS vars + theme as the prototype, scoped
// to a single artboard so light/dark cards can sit next to each other.
function FMScope({ theme = "light", pairing = "native", proseSize = 17, density = "regular", highlightIntensity = "subtle", children, style }) {
  const T = window.FM_TOKENS.themes[theme];
  const P = window.FM_TOKENS.pairings[pairing];
  const cardProseSize = density === "compact" ? 12.5 : density === "comfy" ? 13.5 : 13;
  return (
    <div
      style={{
        "--fm-ui": P.ui,
        "--fm-ui-display": P.uiDisplay,
        "--fm-prose": P.prose,
        "--fm-mono": P.mono,
        "--fm-prose-leading": P.proseLeading,
        "--fm-prose-letterspacing": P.proseLetterSpacing,
        "--fm-prose-size": `${proseSize}px`,
        "--fm-card-prose-size": `${cardProseSize}px`,
        "--fm-anchor-bg": T.anchorBg,
        "--fm-anchor-bg-hover": T.anchorBgHover,
        "--fm-anchor-bg-focus": T.anchorBgFocus,
        "--fm-anchor-bg-resolved": T.anchorBgResolved,
        "--fm-anchor-underline": T.anchorUnderline,
        "--fm-suggest-bg": T.suggestBg,
        "--fm-suggest-bg-focus": T.suggestBgFocus,
        "--fm-suggest-stroke": T.suggestStroke,
        "--fm-orphan-underline": T.orphanUnderline,
        "--fm-prose-ink": T.proseInk,
        "--fm-prose-muted": T.proseMuted,
        "--fm-prose-faint": T.proseFaint,
        "--fm-rule": T.rule,
        "--fm-code": T.code,
        "--fm-code-border": T.codeBorder,
        "--fm-editor-bg": T.editorBg,
        "--fm-text-selection": T.textSelection,
        background: T.editorBg,
        color: T.proseInk,
        fontFamily: P.ui,
        height: "100%",
        ...style,
      }}
      className="fm-root"
      data-theme={theme}
    >
      {children}
    </div>
  );
}

// Thin SVG-only mark candidates for the app icon. Restrained, content-first.
function FMMark({ size = 48, variant = "bracket", theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const fg = T.proseInk;
  const accent = T.accent;
  const bg = theme === "dark" ? "#222" : "#FFFFFF";

  if (variant === "bracket") {
    // [¶] — pilcrow inside square brackets. The mark of a passage commented on.
    return (
      <div style={{ width: size, height: size, borderRadius: size * 0.22, background: bg, border: `0.5px solid ${T.divider}`, boxShadow: "0 2px 6px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 32 32" fill="none">
          <path d="M7 5 L4 5 L4 27 L7 27" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M25 5 L28 5 L28 27 L25 27" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M21 7 H13.2 a4.6 4.6 0 0 0 0 9.2 H15.2 V25 M19.2 7 V25" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    );
  }
  if (variant === "anchor") {
    // Two open/close marker brackets clipping a horizontal rule — visually echoes <!-- fmc:N --> ... <!-- /fmc:N -->.
    return (
      <div style={{ width: size, height: size, borderRadius: size * 0.22, background: bg, border: `0.5px solid ${T.divider}`, boxShadow: "0 2px 6px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 32 32" fill="none">
          <path d="M9 9 L4 16 L9 23" stroke={fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M23 9 L28 16 L23 23" stroke={fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="11" y1="16" x2="21" y2="16" stroke={accent} strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  if (variant === "forge") {
    // F + comment notch in negative space — closer to "Forgemark" wordmark hint.
    return (
      <div style={{ width: size, height: size, borderRadius: size * 0.22, background: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 32 32" fill="none">
          <path d="M8 5 H26 V11 H14 V14 H22 V20 H14 V27 H8 Z" fill={bg} />
          <circle cx="25" cy="22" r="3" fill={accent} />
        </svg>
      </div>
    );
  }
  return null;
}

function FMWordmark({ size = 28, theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: T.proseInk,
        display: "inline-flex",
        alignItems: "baseline",
        gap: 0,
      }}
    >
      <span>Forge</span>
      <span style={{ color: T.accent }}>mark</span>
    </div>
  );
}

// Color swatch
function FMSwatch({ name, value, role, light = true }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "-apple-system, sans-serif", fontSize: 11.5 }}>
      <div style={{ width: 28, height: 28, borderRadius: 6, background: value, border: "0.5px solid rgba(0,0,0,0.10)", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
        <span style={{ color: light ? "#1B1B1A" : "#ECECEC", fontWeight: 600 }}>{name}</span>
        <span style={{ color: light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)", fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 10.5 }}>{value.replace(/^rgba?\((.*)\)$/, "$1")}</span>
        {role && <span style={{ color: light ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.5)", fontSize: 10.5 }}>{role}</span>}
      </div>
    </div>
  );
}

// Small inline anchor for the highlight matrix
function HLAnchor({ kind, theme }) {
  const T = window.FM_TOKENS.themes[theme];
  const styles = {
    default: { background: T.anchorBg },
    hover: { background: T.anchorBgHover },
    focused: { background: T.anchorBgFocus, borderBottom: `0.5px solid ${T.anchorUnderline}` },
    resolved: { background: T.anchorBgResolved, color: T.proseMuted },
    suggestion: { background: T.suggestBg },
    suggestionFocused: { background: T.suggestBgFocus, borderBottom: `0.5px solid ${T.suggestStroke}` },
    orphan: { background: "transparent", borderBottom: `1px dashed ${T.orphanUnderline}` },
  };
  const s = styles[kind] || styles.default;
  return (
    <span style={{ ...s, padding: "0 1px", borderRadius: 1 }}>
      retained at roughly twice the rate
    </span>
  );
}

function HighlightRow({ label, kind, theme, note }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 200px", gap: 16, alignItems: "baseline", padding: "10px 0", borderTop: `0.5px solid ${T.divider}` }}>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 11.5, fontWeight: 600, color: T.chromeMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: window.FM_TOKENS.pairings.native.prose, fontSize: 15, lineHeight: 1.55, color: T.proseInk }}>
        Teams who scheduled a kickoff with their account engineer <HLAnchor kind={kind} theme={theme} /> of self-serve teams.
      </div>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 11, color: T.chromeMuted, lineHeight: 1.4 }}>{note}</div>
    </div>
  );
}

// Single sample card factory
function SampleCard({ comment, focused = false, theme = "light", authorName = "Maya" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <FMScope theme={theme}>
      <div style={{ padding: 14, background: T.sidebarBg, height: "100%" }}>
        <FMCard
          comment={comment}
          theme={T}
          focused={focused}
          authorName={authorName}
          onFocus={() => {}}
          onResolve={() => {}}
          onUnresolve={() => {}}
          onAccept={() => {}}
          onReject={() => {}}
          onReply={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </div>
    </FMScope>
  );
}

// Mock window for secondary screens — simpler than the full prototype chrome.
function MiniWindow({ title, theme = "light", children, height = 480, width = 720 }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{ width, height, borderRadius: 12, overflow: "hidden", background: T.editorBg, boxShadow: "0 0 0 1px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 38, display: "flex", alignItems: "center", padding: "0 12px", background: T.titlebarBg, borderBottom: `0.5px solid ${T.titlebarBorder}`, position: "relative", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 7 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: c, border: "0.5px solid rgba(0,0,0,0.18)" }} />
          ))}
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontSize: 12.5, fontWeight: 600, color: T.chromeText, fontFamily: "-apple-system, sans-serif" }}>
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Secondary screens ────────────────────────────────────────────────

function ScreenSettings({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const Section = ({ label, children }) => (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 24, padding: "16px 0", borderTop: `0.5px solid ${T.divider}`, alignItems: "start" }}>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12.5, fontWeight: 600, color: T.chromeText, textAlign: "right", paddingTop: 4 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
  return (
    <FMScope theme={theme} style={{ padding: 0 }}>
      <MiniWindow title="Forgemark — Settings" theme={theme} height={560} width={680}>
        <div style={{ flex: 1, padding: "16px 32px 28px", overflow: "auto" }}>
          <Section label="Author name">
            <input
              defaultValue="Maya Chen"
              style={{
                width: 280, padding: "5px 9px",
                fontFamily: "-apple-system, sans-serif", fontSize: 13,
                color: T.proseInk, background: theme === "dark" ? "#1A1A1A" : "#FFFFFF",
                border: `0.5px solid ${T.dividerStrong}`, borderRadius: 5, outline: "none",
              }}
            />
            <div style={{ fontSize: 11, color: T.chromeMuted, marginTop: 4 }}>
              Used to attribute every comment, reply, and suggested edit you create.
            </div>
          </Section>
          <Section label="Theme">
            <div style={{ display: "inline-flex", background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", borderRadius: 6, padding: 2 }}>
              {["Light", "Dark", "System"].map((m, i) => (
                <div key={m} style={{
                  fontFamily: "-apple-system, sans-serif", fontSize: 12,
                  fontWeight: i === 2 ? 600 : 500,
                  color: i === 2 ? T.chromeText : T.chromeMuted,
                  padding: "3px 12px",
                  background: i === 2 ? (theme === "dark" ? "#3F3F3F" : "#FFFFFF") : "transparent",
                  borderRadius: 4,
                }}>{m}</div>
              ))}
            </div>
          </Section>
          <Section label="Font size">
            <div style={{ display: "flex", alignItems: "center", gap: 12, width: 280 }}>
              <span style={{ fontSize: 11, color: T.chromeMuted }}>A</span>
              <div style={{ flex: 1, height: 4, background: T.divider, borderRadius: 2, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "55%", background: T.accent, borderRadius: 2 }} />
                <div style={{ position: "absolute", left: "55%", top: "50%", transform: "translate(-50%,-50%)", width: 14, height: 14, background: "#FFFFFF", border: "0.5px solid rgba(0,0,0,0.2)", borderRadius: "50%", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
              </div>
              <span style={{ fontSize: 16, color: T.chromeMuted }}>A</span>
            </div>
            <div style={{ fontSize: 11, color: T.chromeMuted, marginTop: 6 }}>17 pt</div>
          </Section>
          <Section label="Skill package">
            <div style={{ padding: 12, background: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)", borderRadius: 8, border: `0.5px solid ${T.divider}`, maxWidth: 360 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.chromeText, marginBottom: 4 }}>
                forgemark.skill
              </div>
              <div style={{ fontSize: 11.5, color: T.chromeMuted, lineHeight: 1.45, marginBottom: 10 }}>
                A small archive AI agents load to learn the comment format. Share with any agent that should read or write comments in your files.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12, fontWeight: 600, color: "#FFF", background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)", borderRadius: 5, padding: "4px 11px" }}>
                  Download .skill…
                </button>
                <button style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12, color: T.chromeText, background: "transparent", border: `0.5px solid ${T.dividerStrong}`, borderRadius: 5, padding: "4px 11px" }}>
                  View on web
                </button>
              </div>
            </div>
          </Section>
        </div>
      </MiniWindow>
    </FMScope>
  );
}

function ScreenFirstRun({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <MiniWindow title="Welcome to Forgemark" theme={theme} height={520} width={620}>
      <FMScope theme={theme} style={{ height: "100%" }}>
        <div style={{ flex: 1, height: "100%", padding: "44px 56px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", overflow: "auto" }}>
          <FMMark variant="bracket" size={56} theme={theme} />
          <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: T.proseInk, marginTop: 18 }}>
            Welcome to Forgemark
          </div>
          <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 14, color: T.chromeMuted, marginTop: 8, maxWidth: 360, lineHeight: 1.5 }}>
            Review markdown documents alongside humans and AI agents. Comments live in the file itself.
          </div>

          <div style={{ width: "100%", maxWidth: 380, marginTop: 32, display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
            <div>
              <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 11, fontWeight: 600, color: T.chromeMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Your name
              </div>
              <input
                defaultValue="Maya Chen"
                style={{
                  width: "100%", padding: "8px 12px",
                  fontFamily: "-apple-system, sans-serif", fontSize: 14,
                  color: T.proseInk, background: theme === "dark" ? "#1A1A1A" : "#FFFFFF",
                  border: `0.5px solid ${T.dividerStrong}`, borderRadius: 7, outline: "none",
                }}
              />
              <div style={{ fontSize: 11, color: T.chromeMuted, marginTop: 5 }}>
                Attached to every comment, reply, and suggested edit you write.
              </div>
            </div>
          </div>

          <button style={{ marginTop: 28, fontFamily: "-apple-system, sans-serif", fontSize: 13, fontWeight: 600, color: "#FFF", background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)", borderRadius: 7, padding: "8px 22px" }}>
            Open a sample file
          </button>
          <div style={{ marginTop: 12, fontSize: 11.5, color: T.chromeFaint }}>
            Or open File → Open… (⌘O)
          </div>
        </div>
      </FMScope>
    </MiniWindow>
  );
}

function ScreenCleanExport({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <FMScope theme={theme} style={{ height: "100%", padding: 0 }}>
      <div style={{ width: "100%", height: "100%", background: T.editorBg, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {/* Faint backdrop hint */}
        <div style={{ position: "absolute", inset: 0, background: theme === "dark" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)" }} />
        <div style={{ position: "relative", width: 380, padding: "22px 24px 20px", background: T.cardBgElevated, borderRadius: 12, border: `0.5px solid ${T.dividerStrong}`, boxShadow: "0 24px 60px rgba(0,0,0,0.30)" }}>
          <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 14, fontWeight: 700, color: T.proseInk, marginBottom: 6 }}>
            Export a clean copy of "Q3 Onboarding — Findings.md"?
          </div>
          <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12.5, lineHeight: 1.5, color: T.proseMuted }}>
            All comments, replies, suggested edits, and inline anchor markers will be removed from the exported copy. The original file is unchanged.
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", background: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: 8, border: `0.5px solid ${T.divider}`, fontFamily: "-apple-system, sans-serif", fontSize: 11.5, color: T.chromeMuted, display: "flex", gap: 8 }}>
            <span style={{ color: T.proseInk, fontWeight: 600 }}>5 open</span>
            <span>·</span>
            <span>1 resolved</span>
            <span>·</span>
            <span>1 suggested edit</span>
            <span>·</span>
            <span>1 lost anchor</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12.5, color: T.chromeText, background: "transparent", border: `0.5px solid ${T.dividerStrong}`, borderRadius: 6, padding: "5px 14px" }}>
              Cancel
            </button>
            <button style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12.5, fontWeight: 600, color: "#FFF", background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)", borderRadius: 6, padding: "5px 14px" }}>
              Export…
            </button>
          </div>
        </div>
      </div>
    </FMScope>
  );
}

function ScreenEmpty({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <MiniWindow title="Untitled.md" theme={theme} height={420} width={680}>
      <FMScope theme={theme} style={{ height: "100%" }}>
        <div style={{ flex: 1, display: "flex", height: "100%" }}>
          <div style={{ flex: 1, padding: "32px 56px", color: T.proseFaint, fontFamily: window.FM_TOKENS.pairings.native.prose, fontSize: 15, lineHeight: 1.55 }}>
            <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 22, fontWeight: 700, color: T.proseMuted, letterSpacing: "-0.02em" }}>
              Untitled
            </div>
            <p style={{ marginTop: 14 }}>
              Open a markdown file to begin reviewing. Drag one into the window, or use File → Open… (⌘O).
            </p>
          </div>
          <div style={{ width: 320, background: T.sidebarBg, borderLeft: `0.5px solid ${T.divider}`, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <FMMark variant="anchor" size={40} theme={theme} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.chromeText, marginTop: 14 }}>
              No comments yet
            </div>
            <div style={{ fontSize: 12, color: T.chromeMuted, marginTop: 4, lineHeight: 1.5 }}>
              Select any passage in the document to add a comment or suggest an edit.
            </div>
          </div>
        </div>
      </FMScope>
    </MiniWindow>
  );
}

function ScreenMenuBar({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const MenuItem = ({ label, accel, separator, danger }) => {
    if (separator) return <div style={{ height: 1, background: T.divider, margin: "4px 0" }} />;
    return (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 14px", fontFamily: "-apple-system, sans-serif", fontSize: 12.5, color: danger ? T.danger : T.proseInk }}>
        <span>{label}</span>
        {accel && <span style={{ color: T.chromeMuted, fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 11.5 }}>{accel}</span>}
      </div>
    );
  };
  return (
    <FMScope theme={theme} style={{ height: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top menubar */}
      <div style={{ display: "flex", alignItems: "center", gap: 22, height: 22, padding: "0 12px", background: theme === "dark" ? "#2D2D2D" : "rgba(255,255,255,0.6)", border: `0.5px solid ${T.divider}`, borderRadius: 6, fontSize: 12.5, color: T.proseInk, fontFamily: "-apple-system, sans-serif", fontWeight: 500 }}>
        <span style={{ fontWeight: 700 }}>Forgemark</span>
        <span>File</span>
        <span style={{ position: "relative" }}>
          Edit
          <span style={{ position: "absolute", left: -10, top: 22, width: 4, height: 4, borderRadius: "50%", background: T.accent }} />
        </span>
        <span>View</span>
        <span>Comment</span>
        <span>Window</span>
        <span>Help</span>
      </div>

      {/* Comment menu open */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 240, padding: "6px 0", background: theme === "dark" ? "#2D2D2D" : "#FFFFFF", border: `0.5px solid ${T.dividerStrong}`, borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.20)" }}>
          <MenuItem label="Add Comment" accel="⌘⇧M" />
          <MenuItem label="Suggest Edit" accel="⌘⇧E" />
          <MenuItem separator />
          <MenuItem label="Reply" accel="⌘R" />
          <MenuItem label="Resolve Thread" accel="⌘⇧K" />
          <MenuItem label="Reopen Thread" />
          <MenuItem separator />
          <MenuItem label="Accept Suggestion" accel="⌘↵" />
          <MenuItem label="Reject Suggestion" accel="⌘⌫" />
          <MenuItem separator />
          <MenuItem label="Next Comment" accel="⌥↓" />
          <MenuItem label="Previous Comment" accel="⌥↑" />
          <MenuItem separator />
          <MenuItem label="Delete Thread…" accel="⌘⌫" danger />
        </div>

        <div style={{ flex: 1, fontFamily: "-apple-system, sans-serif", fontSize: 12.5, lineHeight: 1.55, color: T.proseMuted }}>
          <div style={{ fontWeight: 600, color: T.proseInk, marginBottom: 6 }}>
            Every command has a menu item.
          </div>
          The keyboard accelerator is paired with each one — nothing is keyboard-only. The menubar is the canonical surface a first-time reviewer scans to learn the app.
        </div>
      </div>
    </FMScope>
  );
}

// ── Type pairing comparison ──────────────────────────────────────────

function TypePairingArtboard({ pairing }) {
  const P = window.FM_TOKENS.pairings[pairing];
  return (
    <div style={{ padding: 32, background: T_LIGHT.editorBg, height: "100%", overflow: "hidden", color: T_LIGHT.proseInk }}>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T_LIGHT.chromeMuted, marginBottom: 6 }}>
        Pairing · {P.label}
      </div>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 12.5, color: T_LIGHT.chromeMuted, marginBottom: 22 }}>
        {P.sublabel}
      </div>
      <div style={{ fontFamily: P.uiDisplay, fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", color: T_LIGHT.proseInk, marginBottom: 8 }}>
        Q3 Onboarding Research
      </div>
      <div style={{ fontFamily: P.ui, fontSize: 12.5, color: T_LIGHT.chromeMuted, marginBottom: 18 }}>
        Draft · Maya Chen · revised by Claude · 7 May 2026
      </div>
      <div style={{ fontFamily: P.prose, fontSize: 17, lineHeight: P.proseLeading, letterSpacing: P.proseLetterSpacing, color: T_LIGHT.proseInk, marginBottom: 18 }}>
        Across <span style={{ background: T_LIGHT.anchorBg, padding: "0 1px", borderRadius: 1 }}>fourteen interviews with new enterprise customers</span>, the strongest predictor of week-two retention was whether the team completed a real piece of work — not a tutorial — in the first session.
      </div>
      <div style={{ fontFamily: P.mono, fontSize: 12, color: T_LIGHT.chromeMuted, padding: "10px 12px", background: T_LIGHT.code, borderRadius: 6, border: `0.5px solid ${T_LIGHT.codeBorder}` }}>
        &lt;!-- fmc:1 --&gt;fourteen interviews&lt;!-- /fmc:1 --&gt;
      </div>
    </div>
  );
}

// ── Main canvas ──────────────────────────────────────────────────────

function FMDesignSystem() {
  // Compose the canvas
  return (
    <DesignCanvas>
      {/* BRAND */}
      <DCSection id="brand" title="Brand" subtitle="Wordmark, app icon candidates, color tokens. AI participation is invisible — there is no 'AI' surface to brand.">
        <DCArtboard id="wordmark" label="Wordmark · Forgemark" width={520} height={300}>
          <div style={{ height: "100%", padding: 36, background: T_LIGHT.editorBg, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28 }}>
            <FMWordmark size={48} theme="light" />
            <FMWordmark size={28} theme="light" />
            <FMWordmark size={18} theme="light" />
            <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: 11, color: "rgba(0,0,0,0.45)", textAlign: "center", maxWidth: 360 }}>
              SF Pro Display, semibold-700, -0.02em tracking. The "mark" half takes the system accent so the wordmark recolors with theme.
            </div>
          </div>
        </DCArtboard>

        <DCArtboard id="appicon" label="App icon · candidates" width={520} height={300}>
          <div style={{ height: "100%", padding: 36, background: T_LIGHT.editorBg, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <FMMark variant="bracket" size={88} theme="light" />
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", fontFamily: "-apple-system, sans-serif", fontWeight: 600 }}>Bracketed pilcrow</div>
                <div style={{ fontSize: 10.5, color: "rgba(0,0,0,0.42)", fontFamily: "-apple-system, sans-serif" }}>The mark of a passage commented on</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <FMMark variant="anchor" size={88} theme="light" />
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", fontFamily: "-apple-system, sans-serif", fontWeight: 600 }}>Anchor brackets</div>
                <div style={{ fontSize: 10.5, color: "rgba(0,0,0,0.42)", fontFamily: "-apple-system, sans-serif" }}>Echoes the inline marker pair</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <FMMark variant="forge" size={88} theme="light" />
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", fontFamily: "-apple-system, sans-serif", fontWeight: 600 }}>Glyph + notch</div>
                <div style={{ fontSize: 10.5, color: "rgba(0,0,0,0.42)", fontFamily: "-apple-system, sans-serif" }}>"F" with a comment dot</div>
              </div>
            </div>
          </div>
        </DCArtboard>

        <DCArtboard id="tokens-light" label="Color tokens · light" width={520} height={520}>
          <div style={{ height: "100%", padding: 24, background: T_LIGHT.editorBg, overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FMSwatch name="Editor" value={T_LIGHT.editorBg} role="canvas" />
              <FMSwatch name="Sidebar" value={T_LIGHT.sidebarBg} role="comments lane" />
              <FMSwatch name="Card" value={T_LIGHT.cardBg} role="comment surface" />
              <FMSwatch name="Title bar" value={T_LIGHT.titlebarBg} role="window chrome" />
              <FMSwatch name="Ink" value={T_LIGHT.proseInk} role="prose" />
              <FMSwatch name="Muted" value="rgba(27,27,26,0.62)" role="meta" />
              <FMSwatch name="Anchor" value={T_LIGHT.anchorBg} role="default" />
              <FMSwatch name="Anchor focus" value={T_LIGHT.anchorBgFocus} role="selected card" />
              <FMSwatch name="Suggest" value={T_LIGHT.suggestBg} role="suggested edit" />
              <FMSwatch name="Suggest text" value={T_LIGHT.suggestText} role="diff insert" />
              <FMSwatch name="Lost anchor" value={T_LIGHT.orphanText} role="drift recovery" />
              <FMSwatch name="Accent" value={T_LIGHT.accent} role="system blue" />
            </div>
          </div>
        </DCArtboard>

        <DCArtboard id="tokens-dark" label="Color tokens · dark" width={520} height={520}>
          <div style={{ height: "100%", padding: 24, background: T_DARK.editorBg, overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FMSwatch light={false} name="Editor" value={T_DARK.editorBg} role="canvas" />
              <FMSwatch light={false} name="Sidebar" value={T_DARK.sidebarBg} role="comments lane" />
              <FMSwatch light={false} name="Card" value={T_DARK.cardBg} role="comment surface" />
              <FMSwatch light={false} name="Title bar" value={T_DARK.titlebarBg} role="window chrome" />
              <FMSwatch light={false} name="Ink" value={T_DARK.proseInk} role="prose" />
              <FMSwatch light={false} name="Muted" value="rgba(236,236,236,0.62)" role="meta" />
              <FMSwatch light={false} name="Anchor" value={T_DARK.anchorBg} role="default" />
              <FMSwatch light={false} name="Anchor focus" value={T_DARK.anchorBgFocus} role="selected card" />
              <FMSwatch light={false} name="Suggest" value={T_DARK.suggestBg} role="suggested edit" />
              <FMSwatch light={false} name="Suggest text" value={T_DARK.suggestText} role="diff insert" />
              <FMSwatch light={false} name="Lost anchor" value={T_DARK.orphanText} role="drift recovery" />
              <FMSwatch light={false} name="Accent" value={T_DARK.accent} role="system blue" />
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      {/* TYPE */}
      <DCSection id="type" title="Type" subtitle="Native is locked for v1 — system fonts inherit macOS text rendering and respect user font-size preference. Editorial pairing was considered and dropped (see rationale).">
        <DCArtboard id="type-native" label="Native (SF Pro · SF Mono) — LOCKED v1" width={520} height={420}>
          <TypePairingArtboard pairing="native" />
        </DCArtboard>
        <DCArtboard id="type-editorial" label="Editorial — considered, not shipped" width={520} height={420}>
          <div style={{
            width: "100%", height: "100%", padding: 28,
            background: "#FCFCFB",
            display: "flex", flexDirection: "column", justifyContent: "center", gap: 12,
            fontFamily: '-apple-system, sans-serif',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(0,0,0,0.50)" }}>
              Considered, not shipped
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "#1B1B1A", fontFamily: '"Charter", "Iowan Old Style", Palatino, Georgia, serif' }}>
              Charter prose · SF chrome
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(27,27,26,0.78)", maxWidth: 380, fontFamily: '"Charter", "Iowan Old Style", Palatino, Georgia, serif' }}>
              An editorial pairing using Charter for prose and SF for chrome. The reading texture is warmer, but it competes with the source-view's monospace for the user's attention and weakens the "feels like macOS" pillar. Locked out for v1.
            </div>
            <div style={{
              marginTop: 8, padding: "9px 12px",
              background: "rgba(0,0,0,0.04)", borderRadius: 7,
              fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 11.5, color: "rgba(27,27,26,0.62)",
            }}>
              tokens.js → pairings.editorial — commented, not exported
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      {/* HIGHLIGHTS */}
      <DCSection id="highlights" title="Inline highlight states" subtitle="Quiet by default; gain density only when engaged. Same passage, six states.">
        <DCArtboard id="hl-light" label="Light theme" width={780} height={520}>
          <div style={{ padding: 28, height: "100%", background: T_LIGHT.editorBg, overflow: "auto" }}>
            <HighlightRow theme="light" label="Default" kind="default" note="Reading state. Subtle yellow tint; reads cleanly when scanning." />
            <HighlightRow theme="light" label="Hover" kind="hover" note="Cursor over the anchor. Slightly stronger fill." />
            <HighlightRow theme="light" label="Focused" kind="focused" note="Card selected in sidebar. Underline confirms the link." />
            <HighlightRow theme="light" label="Resolved" kind="resolved" note="Dimmed grey wash; passage stays visible as a reading aid." />
            <HighlightRow theme="light" label="Suggestion" kind="suggestion" note="Green wash distinguishes a proposed edit from a comment." />
            <HighlightRow theme="light" label="Suggestion · focused" kind="suggestionFocused" note="Stronger fill + green underline when its card is selected." />
            <HighlightRow theme="light" label="Lost anchor" kind="orphan" note="No fill, dashed magenta underline — distinct enough to notice, restrained enough not to alarm." />
          </div>
        </DCArtboard>

        <DCArtboard id="hl-dark" label="Dark theme" width={780} height={520}>
          <div style={{ padding: 28, height: "100%", background: T_DARK.editorBg, overflow: "auto" }}>
            <HighlightRow theme="dark" label="Default" kind="default" note="Same shape, lower-key fill — dark themes need restraint." />
            <HighlightRow theme="dark" label="Hover" kind="hover" />
            <HighlightRow theme="dark" label="Focused" kind="focused" />
            <HighlightRow theme="dark" label="Resolved" kind="resolved" />
            <HighlightRow theme="dark" label="Suggestion" kind="suggestion" />
            <HighlightRow theme="dark" label="Suggestion · focused" kind="suggestionFocused" />
            <HighlightRow theme="dark" label="Lost anchor" kind="orphan" />
          </div>
        </DCArtboard>
      </DCSection>

      {/* CARD STATES */}
      <DCSection id="cards" title="Comment card states" subtitle="A peer comment by a human or an AI uses identical chrome. No badges, no quarantine.">
        <DCArtboard id="card-unread" label="Unread" width={400} height={220}>
          <SampleCard
            comment={{
              id: 7, anchor_text: "x", author: "Claude",
              timestamp: "2026-05-07T10:50:00Z", resolved: false,
              body: "The Q1 study used a different definition of retention (week-2 vs week-4). Worth a footnote about whether they're directly comparable.",
              replies: [], state: "unread",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-read" label="Read" width={400} height={220}>
          <SampleCard
            comment={{
              id: 8, anchor_text: "x", author: "Devon",
              timestamp: "2026-05-06T22:12:00Z", resolved: false,
              body: "I think this is the single most counter-intuitive finding. Worth pulling up to the summary.",
              replies: [], state: "read",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-unread-replies" label="Has unread replies" width={400} height={240}>
          <SampleCard
            comment={{
              id: 9, anchor_text: "x", author: "Maya",
              timestamp: "2026-05-07T09:31:00Z", resolved: false,
              body: "Can we get the actual numbers in here?",
              replies: [{ author: "Claude", timestamp: "2026-05-07T09:42:00Z", body: "38% vs 19%, n=14." }],
              state: "has-unread-replies",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-focused" label="Focused" width={400} height={300}>
          <SampleCard
            focused
            comment={{
              id: 10, anchor_text: "x", author: "Claude",
              timestamp: "2026-05-07T09:14:00Z", resolved: false,
              body: "Worth surfacing the sample composition here — were these all from the EMEA cohort, or mixed?",
              replies: [], state: "read",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-resolved" label="Resolved · collapsed" width={400} height={120}>
          <SampleCard
            comment={{
              id: 11, anchor_text: "x", author: "Devon",
              timestamp: "2026-05-06T22:12:00Z", resolved: true,
              body: "Worth pulling up to the summary.",
              replies: [{ author: "Maya", timestamp: "2026-05-07T08:01:00Z", body: "Done." }],
              state: "read",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-suggestion" label="Suggested edit · focused" width={400} height={340}>
          <SampleCard
            focused
            comment={{
              id: 12, anchor_text: '"the part you skim"', author: "Maya",
              timestamp: "2026-05-07T09:48:00Z", resolved: false,
              suggested_edit: { from: '"the part you skim before getting to the actual thing"', to: '"the warm-up before the real work starts"' },
              body: "Tighter, less colloquial. Same shape.",
              replies: [], state: "read",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-orphan" label="Lost anchor" width={400} height={300}>
          <SampleCard
            comment={{
              id: 13, anchor_text: "onboarding-driven churn (specifically week-3)", author: "Devon",
              timestamp: "2026-05-06T17:40:00Z", resolved: false,
              body: "Was the original window week-3 or month-1?",
              replies: [], state: "read", orphaned: true,
            }}
          />
        </DCArtboard>

        {/* Dark variants */}
        <DCArtboard id="card-dark-focused" label="Dark · focused" width={400} height={300}>
          <SampleCard
            focused
            theme="dark"
            comment={{
              id: 14, anchor_text: "x", author: "Claude",
              timestamp: "2026-05-07T09:14:00Z", resolved: false,
              body: "Worth surfacing the sample composition here.",
              replies: [], state: "read",
            }}
          />
        </DCArtboard>
        <DCArtboard id="card-dark-suggestion" label="Dark · suggested edit" width={400} height={340}>
          <SampleCard
            focused
            theme="dark"
            comment={{
              id: 15, anchor_text: "x", author: "Maya",
              timestamp: "2026-05-07T09:48:00Z", resolved: false,
              suggested_edit: { from: '"the part you skim before getting to the actual thing"', to: '"the warm-up before the real work starts"' },
              body: "Tighter wording.", replies: [], state: "read",
            }}
          />
        </DCArtboard>
      </DCSection>

      {/* SECONDARY SCREENS */}
      <DCSection id="screens" title="Secondary screens" subtitle="First-run, settings, clean-export modal, empty state, command-menu surface.">
        <DCArtboard id="firstrun-light" label="First run · light" width={620} height={520}>
          <ScreenFirstRun theme="light" />
        </DCArtboard>
        <DCArtboard id="firstrun-dark" label="First run · dark" width={620} height={520}>
          <ScreenFirstRun theme="dark" />
        </DCArtboard>
        <DCArtboard id="settings" label="Settings · light" width={680} height={560}>
          <ScreenSettings theme="light" />
        </DCArtboard>
        <DCArtboard id="settings-dark" label="Settings · dark" width={680} height={560}>
          <ScreenSettings theme="dark" />
        </DCArtboard>
        <DCArtboard id="cleanexport" label="Clean Export · confirm" width={620} height={420}>
          <ScreenCleanExport theme="light" />
        </DCArtboard>
        <DCArtboard id="empty" label="Empty state" width={680} height={420}>
          <ScreenEmpty theme="light" />
        </DCArtboard>
        <DCArtboard id="menubar" label="Comment menu — every command has a UI surface" width={680} height={460}>
          <ScreenMenuBar theme="light" />
        </DCArtboard>
      </DCSection>

      {/* v1.1 — BRAND DETAIL */}
      <DCSection id="brand-detail" title="Brand · locked direction" subtitle="Bracketed pilcrow at lockup sizes and the icon-stack render scale.">
        <DCArtboard id="wordmark-lockup" label="Wordmark lockup · light" width={520} height={480}>
          <WordmarkLockup theme="light" />
        </DCArtboard>
        <DCArtboard id="wordmark-lockup-dark" label="Wordmark lockup · dark" width={520} height={480}>
          <WordmarkLockup theme="dark" />
        </DCArtboard>
        <DCArtboard id="glyph-matrix" label="Glyph at icon-stack sizes" width={680} height={400}>
          <GlyphMatrix theme="light" />
        </DCArtboard>
      </DCSection>

      {/* v1.1 — CONFLICT SURFACES */}
      <DCSection id="conflict" title="File-conflict surfaces" subtitle="Edit-during-open and save-conflict. Same modal shape regardless of who made the external change.">
        <DCArtboard id="conflict-banner-light" label="Conflict banner · clean reload, no unsaved work" width={760} height={120}>
          <div style={{ width: "100%", height: "100%", padding: "16px 20px", background: T_LIGHT.editorBg, borderTop: `0.5px solid ${T_LIGHT.divider}` }}>
            <FileConflictBanner theme="light" />
          </div>
        </DCArtboard>
        <DCArtboard id="conflict-banner-dark" label="Conflict banner · dark" width={760} height={120}>
          <div style={{ width: "100%", height: "100%", padding: "16px 20px", background: T_DARK.editorBg, borderTop: `0.5px solid ${T_DARK.divider}` }}>
            <FileConflictBanner theme="dark" />
          </div>
        </DCArtboard>
        <DCArtboard id="edit-during-open-clean" label="Edit-during-open modal · no unsaved work" width={760} height={520}>
          <EditDuringOpenModal theme="light" withUnsavedWork={false} />
        </DCArtboard>
        <DCArtboard id="edit-during-open-unsaved" label="Edit-during-open modal · with unsaved work" width={760} height={520}>
          <EditDuringOpenModal theme="light" withUnsavedWork={true} />
        </DCArtboard>
        <DCArtboard id="save-conflict" label="Save-conflict modal · ⌘S after external change" width={760} height={520}>
          <SaveConflictModal theme="light" />
        </DCArtboard>
        <DCArtboard id="save-conflict-dark" label="Save-conflict modal · dark" width={760} height={520}>
          <SaveConflictModal theme="dark" />
        </DCArtboard>
      </DCSection>

      {/* v1.1 — FLOATING NOTES */}
      <DCSection id="floating" title="Floating notes" subtitle="When a comment's anchor passage is deleted entirely and no candidates can be recovered, the comment becomes a floating note. Schema: anchor_text / context_before / context_after become null; floating: true.">
        <DCArtboard id="floating-card" label="Floating-note card · default" width={420} height={220}>
          <div style={{ padding: 18, background: T_LIGHT.sidebarBg, height: "100%" }}>
            <FloatingNoteCard theme="light" />
          </div>
        </DCArtboard>
        <DCArtboard id="floating-card-focused" label="Floating-note card · focused (action row visible)" width={420} height={280}>
          <div style={{ padding: 18, background: T_LIGHT.sidebarBg, height: "100%" }}>
            <FloatingNoteCard theme="light" focused />
          </div>
        </DCArtboard>
        <DCArtboard id="floating-card-dark" label="Floating-note card · dark" width={420} height={220}>
          <div style={{ padding: 18, background: T_DARK.sidebarBg, height: "100%" }}>
            <FloatingNoteCard theme="dark" />
          </div>
        </DCArtboard>
        <DCArtboard id="floating-sidebar" label="Sidebar with three sections — Lost · Floating · Doc order" width={320} height={620}>
          <FloatingSidebar theme="light" />
        </DCArtboard>
        <DCArtboard id="reattach-v2" label="Reattach modal v2 — three terminal options" width={760} height={520}>
          <ReattachModalV2 theme="light" />
        </DCArtboard>
      </DCSection>

      {/* v1.1 — SOURCE-VIEW NOTICE */}
      <DCSection id="source-notice" title="Source-view notice" subtitle="Selection-to-comment is unavailable in source mode. Read-only review chip in the toolbar with hover tooltip.">
        <DCArtboard id="source-notice-light" label="Source-view chip + tooltip · light" width={680} height={420}>
          <SourceViewNotice theme="light" />
        </DCArtboard>
        <DCArtboard id="source-notice-dark" label="Source-view chip + tooltip · dark" width={680} height={420}>
          <SourceViewNotice theme="dark" />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<FMDesignSystem />);
