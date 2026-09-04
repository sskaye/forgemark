import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import type { DocFormat } from "../format/types";
import {
  buildSourceTextIndex,
  findAnchorPosition,
  makeAnchorFromIndex,
  scrollPaneToRatio,
  scrollRatio,
  type ViewSyncAnchor,
} from "../services/viewSync";
import "./SourceView.css";
import { MARKER_ANY_RE_G } from "../format/types";

// Phase 8 source view: CodeMirror 6.
//
// Why a real editor and not just `<pre>`: we want markdown syntax
// highlighting on the outer markdown layer (headings, emphasis, lists,
// code spans), dimming on the `<!-- fmc:N -->` marker pairs, and a
// subtle background tint on the trailing `<!-- forgemark-comments -->`
// block. CodeMirror handles syntax highlighting + decorations; we'd
// otherwise be reinventing both. Per-language highlighting *inside*
// fenced code is out of scope for v1.
//
// With `editable`, the text can be edited directly: every change goes
// out through `onChange` as the whole text, and the pane keeps it as a
// draft the save writes verbatim. Text pushed in through `text` is
// applied only while the view is not focused, so the user's own
// keystrokes, which come back through that prop, never move their
// caret. Commenting stays a Rendered-view action either way.

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
  // Which grammar to highlight with. The marker and trailing-block
  // decorations below are regex-based and identical either way — only
  // the syntax layer underneath them changes.
  format?: DocFormat;
  // Whether keystrokes change the text. Off, the view is a read-only
  // review surface, as it always was.
  editable?: boolean;
  // The whole text after a user edit; never for text set through `text`.
  onChange?: (text: string) => void;
};

const MARKER_RE = MARKER_ANY_RE_G;

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
function languageFor(format: DocFormat) {
  return format === "html" ? htmlLanguage() : markdown();
}

// Editability flips at runtime (a file can become read-only), so it
// lives in a Compartment and is reconfigured in place.
function editableExtensions(editable: boolean) {
  return [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)];
}

const baseExtensions = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
        caretColor: "var(--fm-prose-ink)",
      },
      ".cm-line": { padding: "0" },
      ".cm-scroller": { fontFamily: "var(--fm-mono)" },
      "&.cm-focused": { outline: "none" },
      "::selection": { background: "var(--fm-text-selection)" },
    },
    { dark: false },
  ),
];

export const SourceView = forwardRef<SourceViewHandle, Props>(function SourceView(
  { text, format = "markdown", editable = false, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The grammar is swapped through a Compartment rather than by
  // rebuilding the editor, so a format change can't discard scroll
  // position or the decorations layered over it.
  const languageCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // True while `text` is being applied, so the listener does not report
  // it back out as an edit.
  const applyingRef = useRef(false);

  // Mount once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: text,
      extensions: [
        ...baseExtensions,
        editableCompartment.current.of(editableExtensions(editable)),
        languageCompartment.current.of(languageFor(format)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingRef.current) return;
          onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (import.meta.env.DEV) {
      (host as unknown as { __forgemarkSourceView?: EditorView }).__forgemarkSourceView = view;
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only on mount — text updates flow through the second effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the doc when the source text changes from outside (a file
  // open, a reload, toggling back from Rendered after edits). Not while
  // the view has focus: the user's own keystrokes come back through
  // this prop, and applying them again would move the caret.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    if (view.hasFocus) return;
    applyingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    } finally {
      applyingRef.current = false;
    }
  }, [text]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(editableExtensions(editable)),
    });
  }, [editable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageFor(format)),
    });
  }, [format]);

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
