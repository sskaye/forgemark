// app.jsx — Main Forgemark prototype shell.
// Two-pane layout: rendered/source document on the left, comments sidebar on the right.
// Owns all interaction state. Tweaks panel for live exploration of design variants.

const FM_TWEAKS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "fontSize": 17,
  "authorName": "Maya"
}/*EDITMODE-END*/;

// Locked defaults (decided by reviewer; surfaced via real product chrome, not Tweaks).
const FM_LOCKED = {
  pairing: "native",
  highlightIntensity: "distinct",
  density: "regular",
  showResolved: true,
};

function FMApp() {
  const [t, setTweak] = useTweaks(FM_TWEAKS);
  const T = window.FM_TOKENS.themes[t.theme === "dark" ? "dark" : "light"];
  const pairing = window.FM_TOKENS.pairings[FM_LOCKED.pairing] || window.FM_TOKENS.pairings.native;

  const [comments, setComments] = React.useState(window.INITIAL_COMMENTS);
  const [focused, setFocused] = React.useState(null);
  const [viewMode, setViewMode] = React.useState("rendered"); // rendered | source
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState("doc");
  const [composer, setComposer] = React.useState(null); // { anchorId, anchorText, rect } | null
  const [hoveredAnchor, setHoveredAnchor] = React.useState(null);
  const [showCleanExport, setShowCleanExport] = React.useState(false);
  const [reattachTarget, setReattachTarget] = React.useState(null); // comment id or null
  const [modified, setModified] = React.useState(false);
  const editorScrollRef = React.useRef(null);
  const sidebarRef = React.useRef(null);
  const cardRefs = React.useRef({});

  // Density → spacing (locked: regular)
  const cardGap = FM_LOCKED.density === "compact" ? 6 : FM_LOCKED.density === "comfy" ? 14 : 10;
  const cardProseSize =
    FM_LOCKED.density === "compact" ? 12.5 : FM_LOCKED.density === "comfy" ? 13.5 : 13;

  // CSS vars driven by tweaks
  const styleVars = {
    "--fm-ui": pairing.ui,
    "--fm-ui-display": pairing.uiDisplay,
    "--fm-prose": pairing.prose,
    "--fm-mono": pairing.mono,
    "--fm-prose-leading": pairing.proseLeading,
    "--fm-prose-letterspacing": pairing.proseLetterSpacing,
    "--fm-prose-size": `${t.fontSize}px`,
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
    "--fm-text-selection": T.textSelection,
    "--fm-prose-ink": T.proseInk,
    "--fm-prose-muted": T.proseMuted,
    "--fm-prose-faint": T.proseFaint,
    "--fm-rule": T.rule,
    "--fm-code": T.code,
    "--fm-code-border": T.codeBorder,
    "--fm-editor-bg": T.editorBg,
    "--fm-highlight-mult": FM_LOCKED.highlightIntensity === "distinct" ? "1.6" : "1",
  };

  // Bookkeeping helpers
  const byId = React.useMemo(() => Object.fromEntries(comments.map((c) => [c.id, c])), [comments]);
  const visibleComments = React.useMemo(() => {
    let list = [...comments];
    if (filter === "open") list = list.filter((c) => !c.resolved);
    else if (filter === "resolved") list = list.filter((c) => c.resolved);
    else if (filter === "mine") list = list.filter((c) => c.author === t.authorName);
    else if (filter === "claude") list = list.filter((c) => c.author === "Claude");
    if (!FM_LOCKED.showResolved && filter === "all") list = list.filter((c) => !c.resolved);
    if (sort === "newest") list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    else if (sort === "oldest") list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    else list.sort((a, b) => a.id - b.id); // doc order ≈ id order in this prototype
    return list;
  }, [comments, filter, sort, t.authorName]);

  const orphanedVisible = visibleComments.filter((c) => c.orphaned);
  const liveVisible = visibleComments.filter((c) => !c.orphaned);
  const totalCount = comments.length;
  const openCount = comments.filter((c) => !c.resolved).length;

  // Anchor element wrapper used by SampleDoc — wires hover + click + ref.
  const Anchor = React.useCallback(
    ({ id, children }) => {
      const c = byId[id];
      const isFocused = focused === id;
      const isHovered = hoveredAnchor === id;
      const isResolved = c && c.resolved;
      const isOrphan = c && c.orphaned;
      const isSuggestion = c && !!c.suggested_edit;

      let cls = "fm-anchor";
      if (isResolved) cls += " fm-anchor-resolved";
      if (isOrphan) cls += " fm-anchor-orphan";
      if (isSuggestion) cls += " fm-anchor-suggestion";
      if (isFocused) cls += " fm-anchor-focused";
      if (isHovered) cls += " fm-anchor-hover";

      return (
        <span
          className={cls}
          data-anchor-id={id}
          onMouseEnter={() => setHoveredAnchor(id)}
          onMouseLeave={() => setHoveredAnchor((h) => (h === id ? null : h))}
          onClick={(e) => {
            e.stopPropagation();
            setFocused(id);
            // Mark as read
            setComments((prev) =>
              prev.map((c) => (c.id === id ? { ...c, state: c.state === "unread" ? "read" : c.state === "has-unread-replies" ? "read" : c.state } : c))
            );
            // Scroll the card into view
            setTimeout(() => {
              const el = cardRefs.current[id];
              if (el && sidebarRef.current) {
                const sb = sidebarRef.current;
                const er = el.getBoundingClientRect();
                const sr = sb.getBoundingClientRect();
                if (er.top < sr.top + 80 || er.bottom > sr.bottom - 20) {
                  sb.scrollBy({ top: er.top - sr.top - 80, behavior: "smooth" });
                }
              }
            }, 0);
          }}
        >
          {children}
        </span>
      );
    },
    [byId, focused, hoveredAnchor]
  );

  // Selection-to-comment handler. The brief calls for an inline composer to
  // appear when the user selects text and initiates a comment.
  React.useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (text.length < 1) return;
      // Only fire for selections inside the rendered prose
      const range = sel.getRangeAt(0);
      const proseEl = document.querySelector(".fm-prose");
      if (!proseEl || !proseEl.contains(range.commonAncestorContainer)) return;
      const rect = range.getBoundingClientRect();
      const containerRect = document.querySelector(".fm-editor-pane").getBoundingClientRect();
      setComposer({
        anchorText: text,
        rect: {
          top: rect.bottom - containerRect.top + 6,
          left: Math.min(rect.left - containerRect.left, containerRect.width - 360),
        },
      });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Card focus → scroll editor anchor into view
  const focusCard = (id) => {
    setFocused(id);
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, state: c.state === "unread" ? "read" : c.state === "has-unread-replies" ? "read" : c.state }
          : c
      )
    );
    setTimeout(() => {
      const el = document.querySelector(`[data-anchor-id="${id}"]`);
      const scroller = editorScrollRef.current;
      if (el && scroller) {
        const er = el.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        if (er.top < sr.top + 60 || er.bottom > sr.bottom - 60) {
          scroller.scrollBy({ top: er.top - sr.top - sr.height / 3, behavior: "smooth" });
        }
      }
    }, 0);
  };

  // Mutation handlers
  const updateComment = (id, fn) => {
    setModified(true);
    setComments((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  };
  const onResolve = (id) => updateComment(id, (c) => ({ ...c, resolved: true }));
  const onUnresolve = (id) => updateComment(id, (c) => ({ ...c, resolved: false }));
  const onReply = (id, body) =>
    updateComment(id, (c) => ({
      ...c,
      replies: [...(c.replies || []), { author: t.authorName, timestamp: new Date().toISOString(), body }],
    }));
  const onEdit = (id, payload) =>
    updateComment(id, (c) => ({
      ...c,
      body: payload.body,
      edited_at: new Date().toISOString(),
      ...(c.suggested_edit && payload.mode === "suggest"
        ? { suggested_edit: { from: c.suggested_edit.from, to: payload.to } }
        : {}),
    }));
  const onAccept = (id) => {
    // In the real app, the document body would be edited and the comment removed.
    // Here, we mark it accepted and remove it from the live list.
    setModified(true);
    setComments((prev) => prev.filter((c) => c.id !== id));
    setFocused(null);
  };
  const onReject = (id) => {
    setModified(true);
    setComments((prev) => prev.filter((c) => c.id !== id));
    setFocused(null);
  };
  const onDelete = (id) => {
    setModified(true);
    setComments((prev) => prev.filter((c) => c.id !== id));
    setFocused(null);
  };

  const onComposerSubmit = ({ body, mode, from, to }) => {
    // Create new comment with next ID
    const nextId = Math.max(0, ...comments.map((c) => c.id)) + 1;
    const newC = {
      id: nextId,
      anchor_text: composer.anchorText,
      author: t.authorName,
      timestamp: new Date().toISOString(),
      resolved: false,
      body,
      replies: [],
      state: "read",
      ...(mode === "suggest"
        ? { suggested_edit: { from: composer.anchorText, to } }
        : {}),
    };
    setModified(true);
    setComments((prev) => [...prev, newC]);
    setComposer(null);
    setFocused(nextId);
    // Clear selection
    window.getSelection().removeAllRanges();
  };

  return (
    <div className="fm-root" style={styleVars}>
      <style>{FM_GLOBAL_CSS}</style>
      <div
        className="fm-window"
        style={{
          background: T.editorBg,
          color: T.proseInk,
        }}
      >
        <FMTitleBar
          title={window.SAMPLE_DOC_FILENAME}
          modified={modified}
          theme={T}
          viewMode={viewMode}
          setViewMode={setViewMode}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        <div
          className="fm-body"
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            background: T.editorBg,
          }}
        >
          {/* Left: editor pane */}
          <div
            className="fm-editor-pane"
            ref={editorScrollRef}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              background: T.editorBg,
              position: "relative",
              borderRight: sidebarOpen ? `0.5px solid ${T.divider}` : "none",
            }}
            onClick={() => { setFocused(null); setComposer(null); }}
          >
            {viewMode === "rendered" ? (
              <>
                {orphanedVisible.length > 0 && (
                  <FMLostAnchorBanner
                    theme={T}
                    count={orphanedVisible.length}
                    onRecover={() => setReattachTarget(orphanedVisible[0].id)}
                    onDismiss={null}
                  />
                )}
                <window.SampleDoc Anchor={Anchor} />
              </>
            ) : (
              <FMSourceView comments={comments} focused={focused} onFocus={focusCard} theme={T} />
            )}

            {/* Inline composer (selection) */}
            {composer && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: composer.rect.top,
                  left: Math.max(40, composer.rect.left),
                  width: 360,
                  zIndex: 20,
                }}
              >
                <FMComposer
                  theme={T}
                  authorName={t.authorName}
                  initialFrom={composer.anchorText}
                  initialTo={composer.anchorText}
                  primaryLabel="Comment"
                  onSubmit={onComposerSubmit}
                  onCancel={() => { setComposer(null); window.getSelection().removeAllRanges(); }}
                />
              </div>
            )}
          </div>

          {/* Right: sidebar */}
          {sidebarOpen && (
            <div
              ref={sidebarRef}
              className="fm-sidebar"
              style={{
                width: 360,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                background: T.sidebarBg,
                overflow: "hidden",
                minHeight: 0,
              }}
              onClick={() => setFocused(null)}
            >
              <FMSidebarHeader
                theme={T}
                total={totalCount}
                unresolved={openCount}
                filter={filter}
                setFilter={setFilter}
                sort={sort}
                setSort={setSort}
              />

              <div
                className="fm-sidebar-scroll"
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: "12px 14px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: cardGap,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {orphanedVisible.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: cardGap }}>
                    <div
                      style={{
                        fontFamily: "var(--fm-ui)", fontSize: 10.5, fontWeight: 700,
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        color: T.orphanText, paddingLeft: 2,
                      }}
                    >
                      Lost anchor · {orphanedVisible.length}
                    </div>
                    {orphanedVisible.map((c) => (
                      <div key={c.id} ref={(el) => { if (el) cardRefs.current[c.id] = el; }}>
                        <FMCard
                          comment={c}
                          theme={T}
                          focused={focused === c.id}
                          authorName={t.authorName}
                          onFocus={focusCard}
                          onResolve={onResolve}
                          onUnresolve={onUnresolve}
                          onAccept={onAccept}
                          onReject={onReject}
                          onReply={onReply}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onReattach={() => setReattachTarget(c.id)}
                        />
                      </div>
                    ))}
                    <div style={{ height: 1, background: T.divider, margin: "6px 0 4px" }} />
                  </div>
                )}

                {liveVisible.length === 0 && orphanedVisible.length === 0 ? (
                  <FMEmptyState theme={T} />
                ) : (
                  liveVisible.map((c) => (
                    <div key={c.id} ref={(el) => { if (el) cardRefs.current[c.id] = el; }}>
                      <FMCard
                        comment={c}
                        theme={T}
                        focused={focused === c.id}
                        authorName={t.authorName}
                        onFocus={focusCard}
                        onResolve={onResolve}
                        onUnresolve={onUnresolve}
                        onAccept={onAccept}
                        onReject={onReject}
                        onReply={onReply}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <FMTweaksPanel t={t} setTweak={setTweak} />
      {reattachTarget != null && (
        <FMReattachModal
          comment={comments.find((c) => c.id === reattachTarget)}
          theme={T}
          onCancel={() => setReattachTarget(null)}
          onReattach={() => {
            setComments((prev) =>
              prev.map((c) =>
                c.id === reattachTarget ? { ...c, orphaned: false, state: "read" } : c
              )
            );
            setReattachTarget(null);
            setModified(true);
          }}
          onDiscard={() => {
            setComments((prev) => prev.filter((c) => c.id !== reattachTarget));
            setReattachTarget(null);
            setModified(true);
          }}
        />
      )}
    </div>
  );
}

// In-document banner shown above the prose when there are lost-anchor comments.
function FMLostAnchorBanner({ theme, count, onRecover, onDismiss }) {
  const T = theme;
  return (
    <div
      style={{
        margin: "16px auto 0",
        maxWidth: 720,
        padding: "10px 14px",
        borderRadius: 8,
        background: T.name === "dark" ? "rgba(220,140,225,0.10)" : "rgba(168,85,170,0.06)",
        border: `0.5px solid ${T.orphanUnderline}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--fm-ui)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: T.orphanText, flexShrink: 0 }}>
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M5.2 6 a1.8 1.8 0 1 1 2.2 1.8 V9.2" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <circle cx="7" cy="10.7" r="0.7" fill="currentColor" />
      </svg>
      <div style={{ flex: 1, fontSize: 12.5, color: T.proseInk, lineHeight: 1.45 }}>
        <strong style={{ fontWeight: 600 }}>{count} {count === 1 ? "comment lost its anchor" : "comments lost their anchors"}.</strong>{" "}
        <span style={{ color: T.proseMuted }}>
          The file was edited outside Forgemark and the original passage{count === 1 ? "" : "s"} can&rsquo;t be located.
        </span>
      </div>
      <button
        onClick={onRecover}
        style={{
          fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600,
          color: T.accentText, background: T.accent,
          border: "0.5px solid rgba(0,0,0,0.10)",
          borderRadius: 6, padding: "4px 12px",
          cursor: "default",
          whiteSpace: "nowrap",
        }}
      >
        Recover…
      </button>
    </div>
  );
}

// Reattach passage picker — shows the original anchor metadata, candidate
// passages with similarity scores, and lets the reviewer pick one.
function FMReattachModal({ comment, theme, onCancel, onReattach, onDiscard }) {
  const T = theme;
  const [selected, setSelected] = React.useState(0);
  if (!comment) return null;

  // Mock candidate passages — in the real product these come from the
  // reattachment strategy described in proposal §185 (anchor_text fuzzy
  // match + context_before/context_after windows).
  const candidates = [
    {
      score: 0.82,
      before: "We&rsquo;ve seen the strongest signal in",
      match: "month-1 churn (specifically week 2–3)",
      after: ", which the proposed work targets directly.",
      reason: "best fuzzy match · context_before aligned",
    },
    {
      score: 0.61,
      before: "Onboarding completion correlates with",
      match: "early-funnel drop-off",
      after: ". A separate study would confirm.",
      reason: "partial match on anchor_text",
    },
    {
      score: 0.48,
      before: "—",
      match: "Pick a passage in the document",
      after: "—",
      reason: "manual: click any text in the editor",
      manual: true,
    },
  ];

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(20,20,24,0.42)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--fm-ui)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540, maxWidth: "92%",
          background: T.cardBg, color: T.proseInk,
          borderRadius: 10,
          border: `0.5px solid ${T.divider}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px 12px", borderBottom: `0.5px solid ${T.divider}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Reattach lost anchor
          </div>
          <div style={{ fontSize: 12, color: T.proseMuted, lineHeight: 1.5 }}>
            {comment.author}&rsquo;s comment was anchored to{" "}
            <span style={{ fontStyle: "italic", color: T.proseInk }}>
              &ldquo;{comment.anchor_text}&rdquo;
            </span>
            , which is no longer in the document. Pick where it should reattach.
          </div>
        </div>

        <div style={{ padding: "10px 12px", maxHeight: 320, overflow: "auto" }}>
          {candidates.map((cand, i) => {
            const isSel = selected === i;
            return (
              <div
                key={i}
                onClick={() => setSelected(i)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 7,
                  marginBottom: 4,
                  cursor: "default",
                  background: isSel ? (T.name === "dark" ? "rgba(10,132,255,0.18)" : "rgba(10,132,255,0.08)") : "transparent",
                  border: `0.5px solid ${isSel ? T.accent : "transparent"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{
                    fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
                    color: cand.manual ? T.proseMuted : T.success, textTransform: "uppercase",
                  }}>
                    {cand.manual ? "MANUAL" : `${Math.round(cand.score * 100)}% MATCH`}
                  </div>
                  <div style={{ fontSize: 11, color: T.proseFaint }}>{cand.reason}</div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: T.proseInk, fontFamily: "var(--fm-prose)" }}>
                  <span style={{ color: T.proseMuted }} dangerouslySetInnerHTML={{ __html: "…" + cand.before + " " }} />
                  <span style={{
                    background: cand.manual ? "transparent" : T.anchorBg,
                    padding: cand.manual ? 0 : "0 2px",
                    borderRadius: 2,
                    fontStyle: cand.manual ? "italic" : "normal",
                    color: cand.manual ? T.proseMuted : T.proseInk,
                  }}>{cand.match}</span>
                  <span style={{ color: T.proseMuted }} dangerouslySetInnerHTML={{ __html: " " + cand.after + "…" }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: "12px 16px",
          borderTop: `0.5px solid ${T.divider}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: T.name === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
        }}>
          <button
            onClick={onDiscard}
            style={{
              fontSize: 12, color: T.proseMuted,
              background: "transparent", border: "none",
              cursor: "default",
              padding: "4px 0",
            }}
          >
            Discard comment
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={onCancel}
              style={{
                fontSize: 12,
                color: T.chromeText, background: "transparent",
                border: `0.5px solid ${T.dividerStrong}`,
                borderRadius: 6, padding: "5px 14px", cursor: "default",
              }}
            >
              Cancel
            </button>
            <button
              onClick={onReattach}
              style={{
                fontSize: 12, fontWeight: 600,
                color: T.accentText, background: T.accent,
                border: "0.5px solid rgba(0,0,0,0.10)",
                borderRadius: 6, padding: "5px 14px", cursor: "default",
              }}
            >
              Reattach here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FMEmptyState({ theme }) {
  const T = theme;
  return (
    <div
      style={{
        marginTop: 24, padding: "24px 18px",
        textAlign: "center",
        color: T.chromeMuted,
        fontFamily: "var(--fm-ui)",
      }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ margin: "0 auto 12px", display: "block" }}>
        <rect x="6" y="9" width="32" height="22" rx="4" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.4" />
        <path d="M14 35 L18 31 H30" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.4" />
        <line x1="13" y1="16" x2="31" y2="16" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="13" y1="20" x2="27" y2="20" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="13" y1="24" x2="24" y2="24" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.chromeText, marginBottom: 4 }}>
        No comments yet
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 220, margin: "0 auto" }}>
        Select any passage in the document to add a comment or suggest an edit.
      </div>
    </div>
  );
}

// Source view — shows raw markdown with inline anchor markers and the
// trailing forgemark-comments YAML block. Cards in the sidebar still link
// to the corresponding markers; per the brief, raw should feel like a peer
// view, not an admin escape hatch.
function FMSourceView({ comments, focused, onFocus, theme }) {
  const T = theme;
  // Build the raw text for the prototype. Real implementation would round-trip
  // through the markdown engine; here we hard-code the body and synthesize the
  // YAML block from the live comments state.
  const body = `# Q3 Onboarding Research — Findings

Draft · Maya Chen · revised by Claude · 7 May 2026

Across <!-- fmc:1 -->fourteen interviews with new enterprise customers<!-- /fmc:1 -->, the strongest predictor of week-two retention was whether the team completed a real piece of work — not a tutorial — in the first session. Tutorial completion alone was uncorrelated with retention, replicating the finding from the Q1 study.

## What worked

Teams who scheduled a kickoff with their account engineer <!-- fmc:2 -->retained at roughly twice the rate<!-- /fmc:2 --> of self-serve teams, even after controlling for company size and prior familiarity with similar tools. The kickoff itself is a thin signal; what matters is the artifact it produces.

Three behaviors showed up in every successful onboarding we observed:

- A named owner on the customer side who could approve workspace-level decisions without escalation.
- A first integration that touched <!-- fmc:3 -->production data, not staging<!-- /fmc:3 --> — the stakes raised attention.
- Documentation read in the same session as setup, not after.

## What didn't

The in-product tour, redesigned in February, has a 71% completion rate but does not move the retention needle. Reviewers consistently described it as <!-- fmc:4 -->"the part you skim before getting to the actual thing"<!-- /fmc:4 -->. We should consider retiring it or repositioning it as reference material.

…`;

  const yaml = comments
    .map((c) => {
      const lines = [
        `- id: ${c.id}`,
        `  anchor_text: "${c.anchor_text.replace(/"/g, '\\"')}"`,
        `  author: ${c.author}`,
        `  timestamp: ${c.timestamp}`,
      ];
      if (c.edited_at) lines.push(`  edited_at: ${c.edited_at}`);
      lines.push(`  resolved: ${c.resolved}`);
      if (c.suggested_edit) {
        lines.push(`  suggested_edit:`);
        lines.push(`    from: "${c.suggested_edit.from.replace(/"/g, '\\"')}"`);
        lines.push(`    to: "${c.suggested_edit.to.replace(/"/g, '\\"')}"`);
      }
      if (c.body) {
        lines.push(`  body: |`);
        c.body.split("\n").forEach((l) => lines.push(`    ${l}`));
      }
      if (c.replies && c.replies.length) {
        lines.push(`  replies:`);
        c.replies.forEach((r) => {
          lines.push(`    - author: ${r.author}`);
          lines.push(`      timestamp: ${r.timestamp}`);
          lines.push(`      body: |`);
          r.body.split("\n").forEach((l) => lines.push(`        ${l}`));
        });
      }
      return lines.join("\n");
    })
    .join("\n");

  // Tokenize for syntax-color: anchor markers, headings, lists, the comments block.
  const renderBody = (txt) => {
    const out = [];
    const re = /<!--\s*\/?fmc:(\d+)\s*-->/g;
    let last = 0, m, key = 0;
    while ((m = re.exec(txt)) !== null) {
      const before = txt.slice(last, m.index);
      out.push(<FMSourceProse key={key++} text={before} theme={T} />);
      out.push(
        <span
          key={key++}
          className="fm-src-anchor"
          data-anchor-id={m[1]}
          onClick={(e) => { e.stopPropagation(); onFocus(parseInt(m[1])); }}
          style={{
            color: focused === parseInt(m[1]) ? T.accent : T.chromeMuted,
            background: focused === parseInt(m[1]) ? T.accentSoft : "transparent",
            borderRadius: 3, padding: "0 2px",
            cursor: "default",
          }}
        >{m[0]}</span>
      );
      last = m.index + m[0].length;
    }
    out.push(<FMSourceProse key={key++} text={txt.slice(last)} theme={T} />);
    return out;
  };

  return (
    <div
      style={{
        fontFamily: "var(--fm-mono)",
        fontSize: 13,
        lineHeight: 1.6,
        color: T.proseInk,
        padding: "32px 56px 80px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxWidth: 820,
      }}
    >
      {renderBody(body)}
      {"\n\n"}
      <span style={{ color: T.chromeMuted }}>{"<!-- forgemark-comments\n"}</span>
      <span>{yaml}</span>
      {"\n"}
      <span style={{ color: T.chromeMuted }}>{"-->\n"}</span>
    </div>
  );
}

function FMSourceProse({ text, theme }) {
  const T = theme;
  // Lightweight syntax: headings + list bullets dimmed
  const lines = text.split("\n");
  return (
    <>
      {lines.map((ln, i) => {
        let content = ln;
        let style = {};
        if (/^#{1,3}\s/.test(ln)) {
          const hashes = ln.match(/^#+/)[0];
          const rest = ln.slice(hashes.length);
          return (
            <span key={i}>
              <span style={{ color: T.chromeFaint }}>{hashes}</span>
              <span style={{ color: T.proseInk, fontWeight: 600 }}>{rest}</span>
              {i < lines.length - 1 && "\n"}
            </span>
          );
        }
        if (/^\s*-\s/.test(ln)) {
          return (
            <span key={i}>
              <span style={{ color: T.chromeFaint }}>{ln.match(/^\s*-/)[0]}</span>
              <span>{ln.slice(ln.match(/^\s*-/)[0].length)}</span>
              {i < lines.length - 1 && "\n"}
            </span>
          );
        }
        return (
          <span key={i}>
            {ln}
            {i < lines.length - 1 && "\n"}
          </span>
        );
      })}
    </>
  );
}

// Tweaks panel content
function FMTweaksPanel({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio
        label="Mode"
        value={t.theme}
        options={["light", "dark"]}
        onChange={(v) => setTweak("theme", v)}
      />
      <TweakSlider
        label="Prose size"
        value={t.fontSize}
        min={14}
        max={22}
        step={1}
        unit="px"
        onChange={(v) => setTweak("fontSize", v)}
      />
      <div style={{ fontSize: 10, color: "rgba(0,0,0,0.45)", marginTop: -4, lineHeight: 1.4 }}>
        In the real app this lives in View → Increase / Decrease Text Size (⌘+ / ⌘−).
      </div>
      <TweakSection label="Identity" />
      <TweakSelect
        label="Author name"
        value={t.authorName}
        options={["Maya", "Devon", "Aria"]}
        onChange={(v) => setTweak("authorName", v)}
      />
    </TweaksPanel>
  );
}

const FM_GLOBAL_CSS = `
  .fm-root, .fm-root * { box-sizing: border-box; }
  body { margin: 0; }
  ::selection { background: var(--fm-text-selection); }

  .fm-root {
    width: 100vw; height: 100vh; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background: oklch(0.93 0.005 250);
    font-family: var(--fm-ui);
  }
  .fm-window {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  /* Prose */
  .fm-prose {
    max-width: 720px;
    margin: 32px auto 80px;
    padding: 0 56px;
    font-family: var(--fm-prose);
    font-size: var(--fm-prose-size);
    line-height: var(--fm-prose-leading);
    letter-spacing: var(--fm-prose-letterspacing);
    color: var(--fm-prose-ink);
    text-wrap: pretty;
    hyphens: auto;
  }
  .fm-prose h1 {
    font-family: var(--fm-ui-display);
    font-size: calc(var(--fm-prose-size) * 1.85);
    line-height: 1.15;
    letter-spacing: -0.02em;
    font-weight: 700;
    margin: 0 0 6px;
  }
  .fm-prose h2 {
    font-family: var(--fm-ui-display);
    font-size: calc(var(--fm-prose-size) * 1.2);
    line-height: 1.25;
    letter-spacing: -0.01em;
    font-weight: 700;
    margin: 1.6em 0 0.5em;
  }
  .fm-prose .fm-byline {
    font-family: var(--fm-ui);
    font-size: calc(var(--fm-prose-size) * 0.78);
    color: var(--fm-prose-muted);
    margin: 0 0 1.8em;
  }
  .fm-prose p, .fm-prose ul, .fm-prose ol { margin: 0 0 1em; }
  .fm-prose li { margin: 0.25em 0; }
  .fm-prose .fm-end-rule {
    margin-top: 3em;
    font-family: var(--fm-ui);
    font-size: calc(var(--fm-prose-size) * 0.78);
    color: var(--fm-prose-faint);
    text-align: center;
    letter-spacing: 0.1em;
  }

  /* Anchors — quiet by default, generous on demand */
  .fm-anchor {
    background: var(--fm-anchor-bg);
    border-bottom: 0.5px solid transparent;
    padding: 0 0.5px;
    border-radius: 1px;
    cursor: default;
    transition: background-color .12s ease, border-color .12s ease;
  }
  .fm-anchor-hover {
    background: var(--fm-anchor-bg-hover);
  }
  .fm-anchor-focused {
    background: var(--fm-anchor-bg-focus);
    border-bottom-color: var(--fm-anchor-underline);
  }
  .fm-anchor-suggestion {
    background: var(--fm-suggest-bg);
  }
  .fm-anchor-suggestion.fm-anchor-focused {
    background: var(--fm-suggest-bg-focus);
    border-bottom-color: var(--fm-suggest-stroke);
  }
  .fm-anchor-resolved {
    background: var(--fm-anchor-bg-resolved);
    color: var(--fm-prose-muted);
  }
  .fm-anchor-orphan {
    background: transparent;
    border-bottom: 1px dashed var(--fm-orphan-underline);
    text-underline-offset: 3px;
  }

  /* Distinct highlight intensity multiplier */
  .fm-root[style*="--fm-highlight-mult: 1.6"] .fm-anchor {
    background: color-mix(in oklab, var(--fm-anchor-bg), oklch(0.85 0.18 80) 30%);
  }

  /* Cards */
  .fm-card { transition: transform .12s ease, box-shadow .12s ease; }
  .fm-card:hover { box-shadow: 0 1px 0 rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06); }

  /* Scrollbars — quiet macOS feel */
  .fm-editor-pane::-webkit-scrollbar,
  .fm-sidebar-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
  .fm-editor-pane::-webkit-scrollbar-track,
  .fm-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
  .fm-editor-pane::-webkit-scrollbar-thumb,
  .fm-sidebar-scroll::-webkit-scrollbar-thumb {
    background: rgba(0,0,0,0.18);
    border-radius: 6px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
  .fm-root [data-theme="dark"] ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); }

  /* Source-view inline marker */
  .fm-src-anchor { font-family: var(--fm-mono); }
`;

ReactDOM.createRoot(document.getElementById("root")).render(<FMApp />);
