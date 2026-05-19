import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import {
  buildSourceTextIndex,
  findAnchorPosition,
  makeAnchorFromIndex,
  scrollPaneToRatio,
  scrollRatio,
  type ViewSyncAnchor,
} from "../services/viewSync";
import "./SourceView.css";

// Phase 8 source view: CodeMirror 6 in read-only mode.
//
// Why a real editor and not just `<pre>`: we want markdown syntax
// highlighting on the outer markdown layer (headings, emphasis, lists,
// code spans), dimming on the `<!-- fmc:N -->` marker pairs, and a
// subtle background tint on the trailing `<!-- forgemark-comments -->`
// block. CodeMirror handles syntax highlighting + decorations; we'd
// otherwise be reinventing both. Per-language highlighting *inside*
// fenced code is out of scope for v1.
//
// The view is read-only — comments are added from Rendered view only.
// The "read-only review" chip in EditorPane communicates this; the
// editable=false attribute and EditorState.readOnly facet enforce it.

export type SourceViewHandle = {
  // Scroll the source view so the opening marker `<!-- fmc:N -->` is in
  // view, with a brief flash to draw the eye. No-op if the marker
  // isn't present in the visible text.
  scrollToMarker: (id: number) => void;
  captureViewportAnchor: (pane: HTMLElement) => ViewSyncAnchor | null;
  scrollToViewportAnchor: (anchor: ViewSyncAnchor) => boolean;
};

type Props = {
  text: string;
};

// Match `<!-- fmc:N -->` or `<!-- /fmc:N -->` for any non-negative integer N.
// Tolerant to whitespace inside the comment so a hand-written file with an
// extra space still dims correctly.
const MARKER_RE = /<!--\s*\/?fmc:\d+\s*-->/g;

// Match the trailing `<!-- forgemark-comments ... -->` block. It opens
// with `<!-- forgemark-comments` on its own line and closes with `-->`
// on its own line. We use a non-greedy match plus an end-of-string
// anchor (allowing trailing whitespace) so we only ever tint the *one*
// trailing block, never accidental copies elsewhere in the doc.
const TRAILING_BLOCK_RE = /<!--\s*forgemark-comments\b[\s\S]*?-->\s*$/;

function buildDecorations(doc: string): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  // Marker dimming
  for (const m of doc.matchAll(MARKER_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    ranges.push({ from, to, deco: markerDeco });
  }

  // Trailing block tint
  const t = doc.match(TRAILING_BLOCK_RE);
  if (t && typeof t.index === "number") {
    const from = t.index;
    const to = from + t[0].length;
    ranges.push({ from, to, deco: trailingDeco });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, r.deco);
  return builder.finish();
}

const markerDeco = Decoration.mark({ class: "fm-cm-marker" });
const trailingDeco = Decoration.mark({ class: "fm-cm-trailing-block" });

const decorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString());
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.state.doc.toString());
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// The base extensions are stable across re-renders; only the doc text
// changes via a Compartment-less transaction (we replace via dispatch).
const baseExtensions = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  markdown(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  decorationPlugin,
  EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        color: "var(--fm-prose-ink)",
        fontFamily: "var(--fm-mono)",
        fontSize: "13px",
        lineHeight: "1.65",
      },
      ".cm-content": {
        padding: "0",
        caretColor: "transparent",
      },
      ".cm-line": { padding: "0" },
      ".cm-scroller": { fontFamily: "var(--fm-mono)" },
      "&.cm-focused": { outline: "none" },
      "::selection": { background: "var(--fm-text-selection)" },
    },
    { dark: false },
  ),
];

export const SourceView = forwardRef<SourceViewHandle, Props>(function SourceView({ text }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // We keep one Compartment around purely to enable surgical reconfigures
  // in the future (e.g. theme swap). For now it's unused but stable.
  const themeCompartment = useRef(new Compartment());

  // Mount once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: text,
      extensions: [...baseExtensions, themeCompartment.current.of([])],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only on mount — text updates flow through the second effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the doc when the source text changes (e.g. user toggles
  // back to Rendered, edits, then toggles to Source). CodeMirror's
  // changes API is the right shape: replace 0..length with new text.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  }, [text]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToMarker(id: number) {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc.toString();
        // Match the *opening* marker for this id specifically.
        const re = new RegExp(`<!--\\s*fmc:${id}\\s*-->`);
        const m = doc.match(re);
        if (!m || typeof m.index !== "number") return;
        const pos = m.index;
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        // Brief flash via a transient line decoration — easy to do with
        // a CSS class on the host scoped by an attribute we toggle.
        const host = view.dom;
        host.setAttribute("data-flash-marker", String(id));
        window.setTimeout(() => {
          if (host.getAttribute("data-flash-marker") === String(id)) {
            host.removeAttribute("data-flash-marker");
          }
        }, 600);
      },
      captureViewportAnchor(pane: HTMLElement) {
        const view = viewRef.current;
        if (!view) return null;
        const paneRect = pane.getBoundingClientRect();
        const viewRect = view.dom.getBoundingClientRect();
        let pos: number | null = null;
        try {
          pos = view.posAtCoords({
            x: Math.max(viewRect.left + 8, paneRect.left + 24),
            y: paneRect.top + 40,
          });
        } catch {
          pos = null;
        }
        return makeAnchorFromIndex(
          buildSourceTextIndex(view.state.doc.toString()),
          pos,
          scrollRatio(pane),
        );
      },
      scrollToViewportAnchor(anchor: ViewSyncAnchor) {
        const view = viewRef.current;
        if (!view) return false;
        const pane = view.dom.closest<HTMLElement>(".fm-editor-pane");
        if (!pane) return false;
        const pos = findAnchorPosition(buildSourceTextIndex(view.state.doc.toString()), anchor);
        if (pos == null) {
          scrollPaneToRatio(pane, anchor.ratio);
          return false;
        }
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }),
        });
        return true;
      },
    }),
    [],
  );

  return <div className="fm-source-view" data-testid="fm-source-view" ref={hostRef} />;
});
