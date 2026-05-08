// design-system-extras.jsx — v1.1 additions in response to dev review.
// New components: file-conflict surfaces, floating-note states, three-option
// reattach modal, source-view notice, expanded wordmark candidates.
//
// All components attach to window so design-system-canvas.jsx can compose them.

const TX_LIGHT = window.FM_TOKENS.themes.light;
const TX_DARK  = window.FM_TOKENS.themes.dark;

// Re-use FMScope shape locally so we don't depend on import order.
function FMXScope({ theme = "light", children, style = {} }) {
  const T = window.FM_TOKENS.themes[theme];
  const P = window.FM_TOKENS.pairings.native;
  return (
    <div
      style={{
        "--fm-ui": P.ui,
        "--fm-ui-display": P.uiDisplay,
        "--fm-prose": P.prose,
        "--fm-mono": P.mono,
        "--fm-prose-leading": P.proseLeading,
        "--fm-prose-letterspacing": P.proseLetterSpacing,
        "--fm-prose-size": "16px",
        "--fm-card-prose-size": "13px",
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
        background: T.editorBg,
        color: T.proseInk,
        fontFamily: P.ui,
        height: "100%",
        ...style,
      }}
      data-theme={theme}
    >
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// File-conflict banner — clean reload, no unsaved work
// ──────────────────────────────────────────────────────────────────────
function FileConflictBanner({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "12px 14px 12px 16px",
        background: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)",
        border: `0.5px solid ${T.dividerStrong}`,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: T.name === "dark" ? '-apple-system, sans-serif' : '-apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: 28, height: 28, borderRadius: "50%",
          background: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: T.chromeMuted, flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 4 L8 10 L14 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.5" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.proseInk, marginBottom: 1 }}>
          This file was modified outside Forgemark.
        </div>
        <div style={{ fontSize: 11.5, color: T.chromeMuted }}>
          About a minute ago · 2 new comments by Claude detected.
        </div>
      </div>
      <button
        style={{
          fontFamily: "var(--fm-ui)", fontSize: 12, color: T.chromeText,
          background: "transparent", border: "none", padding: "5px 10px",
          borderRadius: 5, cursor: "default",
        }}
      >
        Keep your version
      </button>
      <button
        style={{
          fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600, color: "#FFF",
          background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)",
          borderRadius: 5, padding: "5px 12px", cursor: "default",
        }}
      >
        Reload from disk
      </button>
      <button
        aria-label="Dismiss"
        style={{
          width: 22, height: 22, borderRadius: 5, border: "none",
          background: "transparent", color: T.chromeMuted,
          padding: 0, marginLeft: 2, cursor: "default",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit-during-open modal
// ──────────────────────────────────────────────────────────────────────
function EditDuringOpenModal({ theme = "light", withUnsavedWork = true }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{
      width: "100%", height: "100%", position: "relative",
      background: T.editorBg,
      // Faux backdrop showing prose underneath
    }}>
      {/* Backdrop hint */}
      <div style={{
        position: "absolute", inset: 0,
        padding: "32px 56px",
        opacity: 0.35,
        fontFamily: window.FM_TOKENS.pairings.native.prose,
        fontSize: 15, lineHeight: 1.55, color: T.proseMuted,
      }}>
        Across <span style={{ background: T.anchorBg, padding: "0 1px" }}>fourteen interviews</span>, the strongest predictor of week-two retention was whether the team completed a real piece of work — not a tutorial — in the first session.
      </div>
      <div style={{ position: "absolute", inset: 0, background: theme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.32)", backdropFilter: "blur(3px)" }} />

      {/* Modal */}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 480,
          padding: "20px 22px 18px",
          background: T.cardBgElevated || T.cardBg,
          borderRadius: 12,
          border: `0.5px solid ${T.dividerStrong}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)",
          fontFamily: window.FM_TOKENS.pairings.native.ui,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.proseInk, letterSpacing: "-0.01em", marginBottom: 6 }}>
            Reload this file?
          </div>
          <div style={{ fontSize: 12.5, color: T.proseMuted, lineHeight: 1.5, marginBottom: withUnsavedWork ? 12 : 18 }}>
            The file was modified outside Forgemark. The original passages have been preserved; only the comment block at the bottom has new entries.
          </div>

          {withUnsavedWork && (
            <div style={{
              padding: "10px 12px",
              background: theme === "dark" ? "rgba(215,0,21,0.12)" : "rgba(215,0,21,0.06)",
              border: `0.5px solid ${theme === "dark" ? "rgba(255,69,58,0.35)" : "rgba(215,0,21,0.20)"}`,
              borderRadius: 7,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.danger, marginBottom: 4 }}>
                Reloading will discard your unsaved work.
              </div>
              <div style={{ fontSize: 11.5, color: T.chromeMuted, lineHeight: 1.5 }}>
                You have <span style={{ color: T.proseInk, fontWeight: 500 }}>1 open composer</span>, <span style={{ color: T.proseInk, fontWeight: 500 }}>2 edited cards</span>, and <span style={{ color: T.proseInk, fontWeight: 500 }}>1 unsent reply</span>.
              </div>
              <button style={{
                marginTop: 6, padding: 0, background: "transparent", border: "none",
                fontFamily: "var(--fm-ui)", fontSize: 11.5, color: T.accent,
                cursor: "default", display: "flex", alignItems: "center", gap: 4,
              }}>
                <svg width="9" height="9" viewBox="0 0 9 9"><path d="M2 3 L4.5 5.5 L7 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" /></svg>
                Show details
              </button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button style={{
              fontFamily: "var(--fm-ui)", fontSize: 12.5, color: T.chromeText,
              background: "transparent", border: "none",
              borderRadius: 6, padding: "6px 12px", cursor: "default",
            }}>
              Cancel
            </button>
            <button style={{
              fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 500, color: T.proseInk,
              background: theme === "dark" ? "#3F3F3F" : "#FFFFFF",
              border: `0.5px solid ${T.dividerStrong}`,
              borderRadius: 6, padding: "5px 14px", cursor: "default",
              boxShadow: theme === "dark"
                ? "0 0 0 0.5px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.4)"
                : "0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 1.5px rgba(0,0,0,0.08)",
            }}>
              Keep your version
            </button>
            <button style={{
              fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 600, color: "#FFF",
              background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)",
              borderRadius: 6, padding: "5px 14px", cursor: "default",
            }}>
              Reload from disk
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Save-conflict modal
// ──────────────────────────────────────────────────────────────────────
function SaveConflictModal({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: T.editorBg }}>
      <div style={{ position: "absolute", inset: 0, background: theme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.32)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 500, padding: "20px 22px 18px",
          background: T.cardBgElevated || T.cardBg,
          borderRadius: 12, border: `0.5px solid ${T.dividerStrong}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)",
          fontFamily: window.FM_TOKENS.pairings.native.ui,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill={T.danger} fillOpacity="0.12" stroke={T.danger} strokeWidth="0.8" /><path d="M9 5 V10" stroke={T.danger} strokeWidth="1.6" strokeLinecap="round" /><circle cx="9" cy="12.4" r="0.9" fill={T.danger} /></svg>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.proseInk, letterSpacing: "-0.01em" }}>
              This file changed on disk.
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: T.proseMuted, lineHeight: 1.5, marginBottom: 14 }}>
            Forgemark would overwrite changes made by another author or process. Inspect the conflict before deciding.
          </div>

          {/* Comparison strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            border: `0.5px solid ${T.divider}`, borderRadius: 8, overflow: "hidden",
            marginBottom: 16,
          }}>
            <div style={{ padding: "11px 14px", background: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.chromeMuted, marginBottom: 6 }}>
                Your version
              </div>
              <div style={{ fontSize: 12.5, color: T.proseInk, lineHeight: 1.5 }}>
                <div>+ 3 unsaved comments</div>
                <div>+ 1 edit to an existing card</div>
                <div style={{ color: T.chromeMuted, marginTop: 4 }}>since you opened the file 14 min ago</div>
              </div>
            </div>
            <div style={{ padding: "11px 14px", background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderLeft: `0.5px solid ${T.divider}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.chromeMuted, marginBottom: 6 }}>
                On disk
              </div>
              <div style={{ fontSize: 12.5, color: T.proseInk, lineHeight: 1.5 }}>
                <div>+ 2 new comments by Claude</div>
                <div>+ 1 paragraph rewrite</div>
                <div style={{ color: T.chromeMuted, marginTop: 4 }}>last modified 3 min ago</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11.5, color: T.chromeMuted, lineHeight: 1.4, maxWidth: 220 }}>
              Reloading would discard your unsaved work, so it's not offered here.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{
                fontFamily: "var(--fm-ui)", fontSize: 12.5, color: T.danger,
                background: "transparent", border: `0.5px solid ${theme === "dark" ? "rgba(255,69,58,0.35)" : "rgba(215,0,21,0.30)"}`,
                borderRadius: 6, padding: "5px 12px", cursor: "default", fontWeight: 500,
              }}>
                Overwrite disk version
              </button>
              <button style={{
                fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 600, color: "#FFF",
                background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)",
                borderRadius: 6, padding: "5px 14px", cursor: "default",
              }}>
                Cancel and inspect
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Floating-note card (sidebar variant)
// ──────────────────────────────────────────────────────────────────────
function FloatingNoteCard({ theme = "light", focused = false }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{
      position: "relative",
      background: T.cardBg,
      borderRadius: 8,
      border: `0.5px solid ${focused ? T.cardBorderFocused : T.cardBorder}`,
      boxShadow: focused ? T.cardShadowFocused : T.cardShadow,
      padding: "12px 14px",
      paddingLeft: 16,
      fontFamily: window.FM_TOKENS.pairings.native.ui,
    }}>
      {/* Left strip — neutral grey, NOT magenta. Floating is a steady-state. */}
      <div style={{
        position: "absolute", left: 0, top: 8, bottom: 8, width: 2,
        borderRadius: 2,
        background: theme === "dark" ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.20)",
      }} />
      {/* Author row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <FMAvatar name="Devon Cole" theme={T} size={22} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.proseInk }}>Devon Cole</span>
        <span style={{ fontSize: 11.5, color: T.chromeMuted }}>2 days ago</span>
      </div>
      {/* Body */}
      <div style={{ fontSize: 13, lineHeight: 1.5, color: T.proseInk, marginBottom: 8 }}>
        The original onboarding-driven churn paragraph this comment was attached to was deleted. The thread itself is still useful — the conclusion still holds for the v2 study.
      </div>
      {/* Floating-note chip */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 8px",
        background: theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
        border: `0.5px solid ${T.divider}`,
        borderRadius: 4,
        fontSize: 10.5, fontWeight: 500, color: T.chromeMuted,
        fontStyle: "italic",
      }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          {/* paperclip with slash */}
          <path d="M3 2.5 V8.5 a2 2 0 0 0 4 0 V3.2 a1 1 0 1 0-2 0 V8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
        No anchor · floating note
      </div>
      {/* Action row when focused */}
      {focused && (
        <div style={{
          marginTop: 11, paddingTop: 9,
          borderTop: `0.5px solid ${T.divider}`,
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <button style={{
            fontFamily: "var(--fm-ui)", fontSize: 11.5, color: T.chromeText,
            background: "transparent", border: `0.5px solid ${T.divider}`,
            borderRadius: 5, padding: "3px 10px", cursor: "default",
          }}>Reattach…</button>
          <button style={{
            fontFamily: "var(--fm-ui)", fontSize: 11.5, color: T.chromeText,
            background: "transparent", border: "none",
            borderRadius: 5, padding: "3px 10px", cursor: "default",
          }}>Reply</button>
          <button style={{
            fontFamily: "var(--fm-ui)", fontSize: 11.5, color: T.chromeText,
            background: "transparent", border: "none",
            borderRadius: 5, padding: "3px 10px", cursor: "default",
          }}>Resolve</button>
          <div style={{ flex: 1 }} />
          <button style={{
            fontFamily: "var(--fm-ui)", fontSize: 11.5, color: T.danger,
            background: "transparent", border: "none",
            borderRadius: 5, padding: "3px 10px", cursor: "default",
          }}>Discard</button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sidebar with three sections (Lost · Floating · Live)
// ──────────────────────────────────────────────────────────────────────
function FloatingSidebar({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const SectionHeader = ({ label, count, color, sub }) => (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      padding: "6px 4px 8px",
      borderBottom: `0.5px solid ${T.divider}`,
      marginBottom: 10,
    }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em",
        textTransform: "uppercase", color,
      }}>{label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color, letterSpacing: "0.07em" }}>·</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color, letterSpacing: "0.07em" }}>{count}</span>
      {sub && <span style={{ fontSize: 11, color: T.chromeMuted, marginLeft: "auto", fontStyle: "italic" }}>{sub}</span>}
    </div>
  );
  const TinyCard = ({ name, body, kind = "default" }) => {
    const stripColor = kind === "lost" ? T.orphanUnderline
      : kind === "floating" ? (theme === "dark" ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.20)")
      : T.accent;
    return (
      <div style={{
        position: "relative",
        background: T.cardBg,
        borderRadius: 7,
        border: `0.5px solid ${T.cardBorder}`,
        padding: "9px 11px 10px 14px",
        marginBottom: 8,
      }}>
        {kind !== "default" || true ? (
          <div style={{
            position: "absolute", left: 0, top: 8, bottom: 8, width: 2, borderRadius: 2,
            background: stripColor,
          }} />
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <FMAvatar name={name} theme={T} size={18} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: T.proseInk }}>{name}</span>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: T.proseInk }}>{body}</div>
        {kind === "lost" && (
          <div style={{ marginTop: 5, fontSize: 10.5, color: T.orphanText, fontStyle: "italic" }}>
            anchor: "the v2 milestone target"
          </div>
        )}
        {kind === "floating" && (
          <div style={{ marginTop: 5, fontSize: 10.5, color: T.chromeMuted, fontStyle: "italic" }}>
            floating · no anchor
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      width: 320, height: "100%",
      background: T.sidebarBg,
      borderLeft: `0.5px solid ${T.divider}`,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      fontFamily: window.FM_TOKENS.pairings.native.ui,
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `0.5px solid ${T.divider}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.chromeText }}>Comments</span>
          <span style={{ fontSize: 12, color: T.chromeMuted }}>5 open · 7 total</span>
        </div>
      </div>
      {/* Body */}
      <div style={{ flex: 1, padding: "10px 12px 16px", overflow: "auto" }}>
        <SectionHeader label="LOST ANCHOR" count="1" color={T.orphanText} sub="needs attention" />
        <TinyCard kind="lost" name="Maya Chen" body="The week-2 framing changed in the v2 study — was this intentional?" />

        <div style={{ height: 14 }} />

        <SectionHeader label="FLOATING NOTES" count="2" color={T.chromeMuted} sub="no anchor" />
        <TinyCard kind="floating" name="Devon Cole" body="The original churn paragraph was deleted. Conclusion still holds." />
        <TinyCard kind="floating" name="Claude" body="Cross-referencing the appendix data — there's a third cohort worth a paragraph." />

        <div style={{ height: 14 }} />

        <SectionHeader label="DOC ORDER" count="4" color={T.chromeMuted} />
        <TinyCard name="Maya Chen" body="Worth surfacing the sample composition here." />
        <TinyCard name="Claude" body="The Q1 study used a different definition — worth a footnote." />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Reattach modal v2 — three-option footer
// ──────────────────────────────────────────────────────────────────────
function ReattachModalV2({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const Candidate = ({ score, manual = false, reason, preview, selected = false }) => (
    <div style={{
      padding: "10px 12px",
      border: `0.5px solid ${selected ? T.accent : T.divider}`,
      background: selected ? (theme === "dark" ? "rgba(10,132,255,0.12)" : "rgba(10,132,255,0.06)") : "transparent",
      borderRadius: 7,
      marginBottom: 8,
      cursor: "default",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        {manual ? (
          <span style={{
            fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 10.5, fontWeight: 700,
            letterSpacing: "0.06em", color: T.chromeText,
            padding: "1px 6px", borderRadius: 3,
            background: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          }}>MANUAL</span>
        ) : (
          <span style={{
            fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 11.5, fontWeight: 600,
            letterSpacing: "0.04em", color: T.success,
          }}>{score}%</span>
        )}
        <span style={{ fontSize: 11.5, color: T.chromeMuted, fontStyle: "italic" }}>{reason}</span>
      </div>
      <div style={{
        fontFamily: window.FM_TOKENS.pairings.native.prose,
        fontSize: 13.5, lineHeight: 1.5, color: T.proseInk,
      }}>
        {preview}
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: T.editorBg }}>
      <div style={{ position: "absolute", inset: 0, background: theme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.32)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 540,
          padding: "18px 20px 16px",
          background: T.cardBgElevated || T.cardBg,
          borderRadius: 12,
          border: `0.5px solid ${T.dividerStrong}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)",
          fontFamily: window.FM_TOKENS.pairings.native.ui,
        }}>
          {/* Header */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.proseInk, marginBottom: 4 }}>
              Reattach lost anchor
            </div>
            <div style={{ fontSize: 12, color: T.chromeMuted, lineHeight: 1.45 }}>
              <span style={{ fontStyle: "italic", color: T.proseInk }}>"onboarding-driven churn (specifically week-3)"</span>
              <span style={{ marginLeft: 6 }}>· comment by Devon Cole · 2 days ago</span>
            </div>
          </div>

          {/* Candidates */}
          <div style={{ marginBottom: 14 }}>
            <Candidate
              selected
              score="86"
              reason="best fuzzy match · context_before aligned"
              preview={<>Most week-3 fall-off correlates with <span style={{ background: T.anchorBg, padding: "0 1px", borderRadius: 1 }}>onboarding-driven churn (week-3 cohort)</span> — the rewrite kept the framing.</>}
            />
            <Candidate
              score="61"
              reason="partial · embedding similarity to comment body"
              preview={<>The follow-up study segments <span style={{ background: T.anchorBg, padding: "0 1px", borderRadius: 1 }}>retention loss in the third week</span> separately from later attrition.</>}
            />
            <Candidate
              manual
              reason="pick from document"
              preview="Click here to select a passage manually in the editor."
            />
          </div>

          {/* Footer — 3-option */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 12,
            borderTop: `0.5px solid ${T.divider}`,
          }}>
            <button style={{
              fontFamily: "var(--fm-ui)", fontSize: 12, color: T.danger,
              background: "transparent", border: "none",
              borderRadius: 5, padding: "5px 4px", cursor: "default",
            }}>
              Discard comment
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{
                fontFamily: "var(--fm-ui)", fontSize: 12, color: T.chromeText,
                background: "transparent", border: `0.5px solid ${T.dividerStrong}`,
                borderRadius: 5, padding: "5px 11px", cursor: "default",
              }}>
                Keep as floating note
              </button>
              <button style={{
                fontFamily: "var(--fm-ui)", fontSize: 12, color: T.chromeText,
                background: "transparent", border: "none",
                borderRadius: 5, padding: "5px 10px", cursor: "default",
              }}>
                Cancel
              </button>
              <button style={{
                fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600, color: "#FFF",
                background: T.accent, border: "0.5px solid rgba(0,0,0,0.10)",
                borderRadius: 5, padding: "5px 14px", cursor: "default",
              }}>
                Reattach here
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Source-view "read-only review" notice
// ──────────────────────────────────────────────────────────────────────
function SourceViewNotice({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{
      width: "100%", height: "100%", padding: 28,
      background: T.editorBg, color: T.proseInk,
      display: "flex", flexDirection: "column", gap: 16,
      fontFamily: window.FM_TOKENS.pairings.native.ui,
    }}>
      {/* The chip + tooltip rendered together for context */}
      <div style={{ position: "relative", marginTop: 20, marginLeft: 8 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px",
          background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
          border: `0.5px solid ${T.divider}`,
          borderRadius: 6,
          fontSize: 11.5, color: T.chromeMuted,
        }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" />
            <line x1="6" y1="5" x2="6" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="6" cy="3.5" r="0.7" fill="currentColor" />
          </svg>
          Source view · read-only review
        </div>
        {/* Tooltip on hover */}
        <div style={{
          position: "absolute", left: 0, top: "calc(100% + 8px)",
          width: 264,
          padding: "8px 11px",
          background: theme === "dark" ? "#1A1A1A" : "#222",
          color: "#ECECEC",
          borderRadius: 6,
          fontSize: 11.5, lineHeight: 1.45,
          boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
        }}>
          Selection-to-comment is unavailable in source view. Switch to <span style={{ fontFamily: "ui-monospace, SF Mono, monospace", color: "#FFF" }}>Rendered</span> (⌘⇧M) to add comments.
          <div style={{
            position: "absolute", top: -5, left: 14,
            width: 10, height: 10,
            background: theme === "dark" ? "#1A1A1A" : "#222",
            transform: "rotate(45deg)",
          }} />
        </div>
      </div>

      {/* Source-view content underneath, dimmed */}
      <div style={{
        marginTop: 100,
        fontFamily: window.FM_TOKENS.pairings.native.mono,
        fontSize: 12.5, lineHeight: 1.65,
        color: T.proseMuted, opacity: 0.65,
      }}>
        <div># Q3 Onboarding — Findings</div>
        <div style={{ marginTop: 10 }}>
          Across <span style={{ color: T.proseFaint }}>&lt;!-- fmc:1 --&gt;</span>fourteen interviews with new enterprise customers<span style={{ color: T.proseFaint }}>&lt;!-- /fmc:1 --&gt;</span>, the strongest predictor of week-two retention…
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Wordmark + final glyph card
// ──────────────────────────────────────────────────────────────────────
function WordmarkLockup({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  return (
    <div style={{
      height: "100%", padding: 32,
      background: T.editorBg,
      display: "flex", flexDirection: "column", gap: 24, justifyContent: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <FMMark variant="bracket" size={64} theme={theme} />
        <div style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: T.proseInk,
        }}>
          <span>Forge</span><span style={{ color: T.accent }}>mark</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, opacity: 0.92 }}>
        <FMMark variant="bracket" size={32} theme={theme} />
        <div style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: T.proseInk,
        }}>
          <span>Forge</span><span style={{ color: T.accent }}>mark</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.85 }}>
        <FMMark variant="bracket" size={20} theme={theme} />
        <div style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: T.proseInk,
        }}>
          <span>Forge</span><span style={{ color: T.accent }}>mark</span>
        </div>
      </div>
      <div style={{
        marginTop: 8,
        fontSize: 11.5, color: T.chromeMuted, lineHeight: 1.5,
        fontFamily: '-apple-system, sans-serif', maxWidth: 380,
      }}>
        Locked direction: <strong style={{ color: T.proseInk }}>bracketed pilcrow</strong>. Reads as "the mark of a passage commented on". Wordmark uses SF Pro Display semibold-700, -0.02em tracking, with the system accent on "mark".
      </div>
    </div>
  );
}

function GlyphMatrix({ theme = "light" }) {
  const T = window.FM_TOKENS.themes[theme];
  const Cell = ({ size, label }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <FMMark variant="bracket" size={size} theme={theme} />
      <div style={{ fontSize: 10.5, color: T.chromeMuted, fontFamily: "-apple-system, sans-serif" }}>
        {label}
      </div>
    </div>
  );
  return (
    <div style={{
      height: "100%", padding: 28, background: T.editorBg,
      display: "flex", flexDirection: "column", gap: 16, justifyContent: "center",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.chromeMuted, marginBottom: 4, fontFamily: "-apple-system, sans-serif" }}>
        Glyph at icon stack sizes
      </div>
      <div style={{ display: "flex", gap: 28, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Cell size={128} label="1024" />
        <Cell size={88}  label="512" />
        <Cell size={56}  label="256" />
        <Cell size={32}  label="128" />
        <Cell size={20}  label="64" />
        <Cell size={16}  label="32" />
      </div>
      <div style={{
        marginTop: 14, fontSize: 11.5, color: T.chromeMuted, lineHeight: 1.5,
        fontFamily: "-apple-system, sans-serif", maxWidth: 460,
      }}>
        For the production .icns, render the 1024px master and let the Apple icon-stack tooling generate the smaller sizes. The bracketed pilcrow is legible down to 32px; below that, fall back to the wordmark.
      </div>
    </div>
  );
}

Object.assign(window, {
  FileConflictBanner,
  EditDuringOpenModal,
  SaveConflictModal,
  FloatingNoteCard,
  FloatingSidebar,
  ReattachModalV2,
  SourceViewNotice,
  WordmarkLockup,
  GlyphMatrix,
});
