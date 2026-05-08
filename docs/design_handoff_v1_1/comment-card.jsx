// comment-card.jsx — Comment card component (all states + suggested-edit variant)
// Plus the inline composer (new / reply / edit / suggest-edit modes).

function FMRelTime({ iso }) {
  // Stable rel-time relative to the doc's "now" (5/7 11:00Z) so the prototype
  // doesn't drift with the wall clock.
  const now = new Date("2026-05-07T11:00:00Z").getTime();
  const t = new Date(iso).getTime();
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function FMDiffPreview({ from, to, theme }) {
  const T = theme;
  return (
    <div
      style={{
        fontFamily: "var(--fm-prose)",
        fontSize: "var(--fm-card-prose-size, 13px)",
        lineHeight: 1.45,
        color: T.proseInk,
        padding: "8px 10px",
        background: T.suggestBg,
        borderRadius: 6,
        border: `0.5px solid ${T.suggestStroke}`,
        margin: "6px 0",
      }}
    >
      <span
        style={{
          textDecoration: "line-through",
          textDecorationColor: T.proseFaint,
          color: T.proseMuted,
        }}
      >
        {from}
      </span>
      <span style={{ color: T.proseFaint, margin: "0 6px" }}>→</span>
      <span style={{ color: T.suggestText, fontWeight: 500 }}>{to}</span>
    </div>
  );
}

// Inline composer — used for new comment, reply, and edit modes.
function FMComposer({
  theme,
  authorName,
  initialBody = "",
  initialMode = "comment", // comment | suggest
  initialFrom = "",
  initialTo = "",
  showSuggestToggle = true,
  primaryLabel = "Comment",
  onSubmit,
  onCancel,
  compact = false,
  autoFocus = true,
}) {
  const T = theme;
  const [body, setBody] = React.useState(initialBody);
  const [mode, setMode] = React.useState(initialMode);
  const [from, setFrom] = React.useState(initialFrom);
  const [to, setTo] = React.useState(initialTo);
  const taRef = React.useRef(null);

  React.useEffect(() => {
    if (autoFocus && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(initialBody.length, initialBody.length);
    }
  }, []);

  const canSubmit = mode === "suggest"
    ? to.trim().length > 0
    : body.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ body: body.trim(), mode, from: from, to: to.trim() });
  };

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      onCancel && onCancel();
    }
  };

  return (
    <div
      style={{
        padding: compact ? 10 : 12,
        background: T.cardBgElevated,
        borderRadius: 10,
        border: `0.5px solid ${T.cardBorderFocused}`,
        boxShadow: T.cardShadowFocused,
      }}
      onKeyDown={onKey}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <FMAvatar name={authorName} theme={T} size={22} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 600, color: T.chromeText }}>
            {authorName}
          </span>
          <span style={{ fontFamily: "var(--fm-ui)", fontSize: 11, color: T.chromeMuted }}>
            {mode === "suggest" ? "Suggesting an edit" : "New comment"}
          </span>
        </div>
      </div>

      {mode === "suggest" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          <FMComposerField
            theme={T} label="From"
            value={from}
            onChange={setFrom}
            readOnly
            multiline
          />
          <FMComposerField
            theme={T} label="To"
            value={to}
            onChange={setTo}
            placeholder="Replacement text…"
            multiline
            innerRef={taRef}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note (optional)"
            rows={2}
            style={{
              fontFamily: "var(--fm-ui)",
              fontSize: 13,
              lineHeight: 1.45,
              color: T.proseInk,
              background: "transparent",
              border: `0.5px solid ${T.divider}`,
              borderRadius: 6,
              padding: "6px 8px",
              outline: "none",
              resize: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          style={{
            fontFamily: "var(--fm-ui)",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: T.proseInk,
            background: "transparent",
            border: `0.5px solid ${T.divider}`,
            borderRadius: 6,
            padding: "8px 10px",
            outline: "none",
            resize: "none",
            width: "100%",
            boxSizing: "border-box",
            marginBottom: 8,
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {showSuggestToggle && (
          <button
            onClick={() => setMode(mode === "suggest" ? "comment" : "suggest")}
            title="Suggest an edit"
            style={{
              fontFamily: "var(--fm-ui)",
              fontSize: 12,
              color: mode === "suggest" ? T.suggestText : T.chromeMuted,
              background: mode === "suggest" ? T.suggestBg : "transparent",
              border: `0.5px solid ${mode === "suggest" ? T.suggestStroke : T.divider}`,
              borderRadius: 6,
              padding: "4px 9px",
              cursor: "default",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 7.5 L5.5 4 L7 5.5 L3.5 9 H2 V7.5Z" stroke="currentColor" strokeWidth="1" fill="none" />
              <path d="M5.5 4 L7.5 2 L9 3.5 L7 5.5" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
            Suggest edit
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onCancel}
          style={{
            fontFamily: "var(--fm-ui)", fontSize: 12,
            color: T.chromeText,
            background: "transparent",
            border: `0.5px solid ${T.divider}`,
            borderRadius: 6,
            padding: "4px 11px",
            cursor: "default",
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600,
            color: T.accentText,
            background: canSubmit ? T.accent : T.accentSoftStrong,
            opacity: canSubmit ? 1 : 0.6,
            border: "0.5px solid rgba(0,0,0,0.10)",
            borderRadius: 6,
            padding: "4px 11px",
            cursor: "default",
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
        >
          {mode === "suggest" ? "Suggest" : primaryLabel}
          <span style={{ opacity: 0.75, fontWeight: 500, fontSize: 10.5, marginLeft: 1 }}>⌘↵</span>
        </button>
      </div>
    </div>
  );
}

function FMComposerField({ theme, label, value, onChange, readOnly, placeholder, multiline, innerRef }) {
  const T = theme;
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--fm-ui)", fontSize: 10.5, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.06em",
          color: T.chromeFaint, marginBottom: 3, paddingLeft: 1,
        }}
      >{label}</div>
      <textarea
        ref={innerRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={multiline ? 2 : 1}
        style={{
          fontFamily: "var(--fm-prose)",
          fontSize: 13,
          lineHeight: 1.45,
          color: readOnly ? T.proseMuted : T.proseInk,
          background: readOnly
            ? (T.name === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)")
            : "transparent",
          border: `0.5px solid ${T.divider}`,
          borderRadius: 6,
          padding: "6px 8px",
          outline: "none",
          resize: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// Reply row — same shape as a comment but minimal.
function FMReply({ reply, theme }) {
  const T = theme;
  return (
    <div style={{ display: "flex", gap: 8, paddingTop: 10 }}>
      <FMAvatar name={reply.author} theme={T} size={20} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 600, color: T.chromeText }}>
            {reply.author}
          </span>
          <span style={{ fontFamily: "var(--fm-ui)", fontSize: 11, color: T.chromeMuted }}>
            <FMRelTime iso={reply.timestamp} />
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--fm-prose)",
            fontSize: "var(--fm-card-prose-size, 13px)",
            lineHeight: 1.5,
            color: T.proseInk,
            marginTop: 2,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {reply.body}
        </div>
      </div>
    </div>
  );
}

// Comment card — full behavior: focused, unread, has-unread-replies, resolved (collapsed),
// suggested-edit variant, orphaned variant.
function FMCard({
  comment, theme, focused, authorName,
  onFocus, onResolve, onUnresolve, onAccept, onReject, onReply, onEdit, onDelete, onReattach,
}) {
  const T = theme;
  const c = comment;
  const isSuggestion = !!c.suggested_edit;
  const isResolved = c.resolved;
  const isOrphan = c.orphaned;
  const isUnread = c.state === "unread";
  const hasUnreadReplies = c.state === "has-unread-replies";

  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Resolved cards collapse — show a one-line summary; click to focus expands.
  if (isResolved && !focused) {
    return (
      <div
        onClick={() => onFocus(c.id)}
        className="fm-card fm-card-resolved"
        style={{
          padding: "8px 12px",
          background: "transparent",
          borderRadius: 8,
          border: `0.5px dashed ${T.divider}`,
          display: "flex", alignItems: "center", gap: 8,
          cursor: "default",
          opacity: 0.75,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ color: T.chromeMuted, flexShrink: 0 }}>
          <path d="M2 5.8 L4.4 8 L9 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          style={{
            fontFamily: "var(--fm-ui)", fontSize: 12, color: T.chromeMuted,
            flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          <span style={{ fontWeight: 600, color: T.chromeText }}>{c.author}</span>
          {" · "}
          <span style={{ fontStyle: "italic" }}>{c.body || "(suggestion)"}</span>
        </span>
        <span style={{ fontFamily: "var(--fm-ui)", fontSize: 11, color: T.chromeFaint }}>
          Resolved
        </span>
      </div>
    );
  }

  // Card chrome
  const cardBorder = focused
    ? T.cardBorderFocused
    : (isUnread ? T.cardBorder : T.cardBorder);
  const cardShadow = focused ? T.cardShadowFocused : T.cardShadow;

  return (
    <div
      onClick={(e) => {
        if (replying || editing) return;
        onFocus(c.id);
      }}
      className={`fm-card ${focused ? "fm-card-focused" : ""}`}
      style={{
        padding: 12,
        background: T.cardBg,
        borderRadius: 10,
        border: `0.5px solid ${cardBorder}`,
        boxShadow: cardShadow,
        position: "relative",
        cursor: "default",
        transition: "box-shadow .12s ease, border-color .12s ease, transform .12s ease",
        transform: focused ? "translateY(-1px)" : "none",
      }}
    >
      {/* Unread strip */}
      {isUnread && (
        <div
          style={{
            position: "absolute", left: -1, top: 8, bottom: 8, width: 2,
            background: T.accent, borderRadius: 1,
          }}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FMAvatar name={c.author} theme={T} size={22} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--fm-ui)", fontSize: 12.5, fontWeight: 600, color: T.chromeText }}>
              {c.author}
            </span>
            <span style={{ fontFamily: "var(--fm-ui)", fontSize: 11, color: T.chromeMuted }}>
              <FMRelTime iso={c.timestamp} />
              {c.edited_at && <span style={{ fontStyle: "italic", marginLeft: 4 }}>· edited</span>}
            </span>
          </div>
        </div>

        {/* Resolve check */}
        {!isSuggestion && !isOrphan && (
          <button
            onClick={(e) => { e.stopPropagation(); onResolve(c.id); }}
            title="Resolve thread"
            style={{
              width: 22, height: 22, borderRadius: 6,
              border: `0.5px solid ${T.divider}`,
              background: "transparent",
              color: T.chromeMuted,
              padding: 0, cursor: "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.8 L4.4 8 L9 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Overflow menu */}
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="More"
            style={{
              width: 22, height: 22, borderRadius: 6,
              border: "none", background: "transparent",
              color: T.chromeMuted,
              padding: 0, cursor: "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <circle cx="3" cy="7" r="1.1" />
              <circle cx="7" cy="7" r="1.1" />
              <circle cx="11" cy="7" r="1.1" />
            </svg>
          </button>
          {menuOpen && (
            <FMOverflowMenu
              theme={T}
              onClose={() => setMenuOpen(false)}
              items={[
                c.author === authorName && { label: "Edit", onClick: () => { setEditing(true); setMenuOpen(false); } },
                isResolved
                  ? { label: "Reopen", onClick: () => { onUnresolve(c.id); setMenuOpen(false); } }
                  : null,
                { label: "Copy link to comment", onClick: () => setMenuOpen(false) },
                { divider: true },
                { label: "Delete thread", danger: true, onClick: () => { onDelete(c.id); setMenuOpen(false); } },
              ].filter(Boolean)}
            />
          )}
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <div style={{ marginTop: 10 }}>
          <FMComposer
            theme={T}
            authorName={authorName}
            initialBody={c.body}
            initialMode={isSuggestion ? "suggest" : "comment"}
            initialFrom={isSuggestion ? c.suggested_edit.from : ""}
            initialTo={isSuggestion ? c.suggested_edit.to : ""}
            showSuggestToggle={false}
            primaryLabel="Save"
            onSubmit={(payload) => { onEdit(c.id, payload); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          {/* Suggested edit preview */}
          {isSuggestion && (
            <FMDiffPreview
              from={c.suggested_edit.from}
              to={c.suggested_edit.to}
              theme={T}
            />
          )}

          {/* Body text */}
          {c.body && (
            <div
              style={{
                fontFamily: "var(--fm-prose)",
                fontSize: "var(--fm-card-prose-size, 13px)",
                lineHeight: 1.5,
                color: T.proseInk,
                marginTop: isSuggestion ? 0 : 8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {c.body}
            </div>
          )}

          {/* Replies */}
          {c.replies && c.replies.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {hasUnreadReplies && !focused && (
                <div
                  style={{
                    fontFamily: "var(--fm-ui)", fontSize: 11, fontWeight: 600,
                    color: T.accent, marginTop: 8,
                  }}
                >
                  {c.replies.length} new {c.replies.length === 1 ? "reply" : "replies"}
                </div>
              )}
              {(focused || !hasUnreadReplies) && c.replies.map((r, i) => (
                <FMReply key={i} reply={r} theme={T} />
              ))}
            </div>
          )}

          {/* Orphan banner */}
          {isOrphan && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: T.name === "dark" ? "rgba(220,140,225,0.10)" : "rgba(168,85,170,0.06)",
                border: `0.5px solid ${T.orphanUnderline}`,
                fontFamily: "var(--fm-ui)", fontSize: 12,
                color: T.proseInk,
                display: "flex", alignItems: "flex-start", gap: 6,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: T.orphanText, marginTop: 2, flexShrink: 0 }}>
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.1" fill="none" />
                <path d="M4.5 5 a1.5 1.5 0 1 1 1.8 1.5 V8" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
                <circle cx="6" cy="9.4" r="0.6" fill="currentColor" />
              </svg>
              <span style={{ flex: 1, color: T.proseMuted }}>
                Lost anchor — was{" "}
                <span style={{ fontStyle: "italic", color: T.proseInk }}>"{c.anchor_text}"</span>.
              </span>
            </div>
          )}

          {/* Action row */}
          {focused && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6,
                marginTop: 12, paddingTop: 10,
                borderTop: `0.5px solid ${T.divider}`,
              }}
            >
              {isSuggestion ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onAccept(c.id); }}
                    style={{
                      fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600,
                      color: T.accentText, background: T.success,
                      border: "0.5px solid rgba(0,0,0,0.10)",
                      borderRadius: 6, padding: "4px 12px", cursor: "default",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M2 5.8 L4.4 8 L9 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Accept
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onReject(c.id); }}
                    style={{
                      fontFamily: "var(--fm-ui)", fontSize: 12,
                      color: T.chromeText, background: "transparent",
                      border: `0.5px solid ${T.dividerStrong}`,
                      borderRadius: 6, padding: "4px 12px", cursor: "default",
                    }}
                  >
                    Reject
                  </button>
                </>
              ) : isOrphan ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onReattach && onReattach(c.id); }}
                    style={{
                      fontFamily: "var(--fm-ui)", fontSize: 12, fontWeight: 600,
                      color: T.accentText, background: T.accent,
                      border: "0.5px solid rgba(0,0,0,0.10)",
                      borderRadius: 6, padding: "4px 12px", cursor: "default",
                    }}
                  >
                    Reattach…
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onResolve(c.id); }}
                    style={{
                      fontFamily: "var(--fm-ui)", fontSize: 12,
                      color: T.chromeText, background: "transparent",
                      border: `0.5px solid ${T.dividerStrong}`,
                      borderRadius: 6, padding: "4px 12px", cursor: "default",
                    }}
                  >
                    Discard
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setReplying(true); }}
                  style={{
                    fontFamily: "var(--fm-ui)", fontSize: 12,
                    color: T.chromeText, background: "transparent",
                    border: `0.5px solid ${T.divider}`,
                    borderRadius: 6, padding: "4px 11px", cursor: "default",
                  }}
                >
                  Reply
                </button>
              )}
            </div>
          )}

          {/* Reply composer */}
          {replying && (
            <div style={{ marginTop: 10 }}>
              <FMComposer
                theme={T}
                authorName={authorName}
                showSuggestToggle={false}
                primaryLabel="Reply"
                onSubmit={(payload) => { onReply(c.id, payload.body); setReplying(false); }}
                onCancel={() => setReplying(false)}
                compact
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FMOverflowMenu({ theme, items, onClose }) {
  const T = theme;
  React.useEffect(() => {
    const h = (e) => onClose();
    setTimeout(() => document.addEventListener("click", h), 0);
    return () => document.removeEventListener("click", h);
  }, []);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "calc(100% + 4px)", right: 0,
        zIndex: 50, minWidth: 180,
        background: T.cardBgElevated,
        border: `0.5px solid ${T.dividerStrong}`,
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        padding: 4,
      }}
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} style={{ height: 1, background: T.divider, margin: "4px 2px" }} />
        ) : (
          <button
            key={i}
            onClick={it.onClick}
            style={{
              display: "block", width: "100%", textAlign: "left",
              fontFamily: "var(--fm-ui)", fontSize: 12.5,
              color: it.danger ? T.danger : T.chromeText,
              background: "transparent", border: "none",
              padding: "5px 9px", borderRadius: 5,
              cursor: "default",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? (T.name === "dark" ? "rgba(255,69,58,0.18)" : "rgba(215,0,21,0.10)") : T.accentSoft; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  );
}

Object.assign(window, { FMCard, FMComposer, FMReply, FMRelTime, FMDiffPreview });
