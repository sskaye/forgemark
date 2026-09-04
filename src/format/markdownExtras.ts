// What GitHub renders beyond the GFM spec, taught to markdown-it once
// for both the block splitter (src/format/blocks.ts) and the editor
// (src/components/editorExtensions.ts), so the two agree on where a
// block starts and ends:
//
//   - footnotes: `[^label]` in text, `[^label]: text` as a block;
//   - alerts: a quote whose first line is `[!NOTE]` (or TIP, IMPORTANT,
//     WARNING, CAUTION) carries the kind on its blockquote;
//   - strikethrough with a single tilde, which the GFM spec allows and
//     markdown-it does not;
//   - math: `$…$` in text and `$$` on its own lines around a block;
//   - with `linkify`, bare `https://…` and `www.…` addresses and e-mail
//     addresses become links, as on GitHub, while a bare `example.com`
//     or `SKILL.md` stays text.
//
// The definitions stay where they are written rather than moving to
// the end of the document, so every block still maps to one node.

import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";

export const ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

const ALERT_LINE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]*/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;

const INSTALLED = Symbol("forgemark-markdown-extras");

export function markdownExtras(md: MarkdownIt, options: { linkify?: boolean } = {}): void {
  // tiptap-markdown runs every extension's setup on every parse.
  const marked = md as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  md.block.ruler.before("reference", "fm_footnote_def", footnoteDef, { alt: ["paragraph"] });
  md.inline.ruler.before("link", "fm_footnote_ref", footnoteRef);
  md.inline.ruler.before("strikethrough", "fm_strike_single", strikeSingle);
  md.block.ruler.before("fence", "fm_math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.inline.ruler.before("escape", "fm_math_inline", mathInline);
  md.core.ruler.after("block", "fm_alert", alerts);
  md.renderer.rules.fm_math_block = (tokens, idx) =>
    `<div data-fm-math-block="${escapeAttr(tokens[idx].content)}"></div>\n`;
  md.renderer.rules.fm_math_inline = (tokens, idx) =>
    `<span data-fm-math="${escapeAttr(tokens[idx].content)}"></span>`;
  md.renderer.rules.fm_footnote_ref = (tokens, idx) => {
    const label = escapeAttr(String(tokens[idx].meta.label));
    return `<sup data-fm-footnote="${label}">${label}</sup>`;
  };

  if (options.linkify) {
    md.set({ linkify: true });
    md.linkify.set({ fuzzyLink: false, fuzzyEmail: true, fuzzyIP: false });
    md.linkify.add("www.", {
      validate: /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^\s<]*)?/i,
      normalize(match) {
        match.url = "http://" + match.url;
      },
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// `[^label]: text`, with lazy continuation lines up to a blank line or
// the start of another block, another definition included. It may
// interrupt a paragraph, as on GitHub, where the definition often
// follows the sentence that cites it with no blank line between.
function footnoteDef(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const m = FOOTNOTE_DEF.exec(state.src.slice(start, max));
  if (!m) return false;
  if (silent) return true;

  const terminators = state.md.block.ruler.getRules("paragraph");
  let nextLine = startLine + 1;
  for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
    if (state.sCount[nextLine] - state.blkIndent > 3) continue;
    if (terminators.some((rule) => rule(state, nextLine, endLine, true))) break;
  }
  const lines = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
  const content = lines.slice(m[0].length).trim();

  const open = state.push("fm_footnote_def_open", "div", 1);
  open.attrSet("data-fm-footnote-def", m[1]);
  open.map = [startLine, nextLine];
  const inline = state.push("inline", "", 0);
  inline.content = content;
  inline.map = [startLine, nextLine];
  inline.children = [];
  state.push("fm_footnote_def_close", "div", -1);
  state.line = nextLine;
  return true;
}

function footnoteRef(state: StateInline, silent: boolean) {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5e /* ^ */)
    return false;
  const m = FOOTNOTE_REF.exec(src.slice(pos, posMax));
  if (!m) return false;
  if (!silent) {
    const token = state.push("fm_footnote_ref", "", 0);
    token.meta = { label: m[1] };
  }
  state.pos += m[0].length;
  return true;
}

const isSpace = (code: number) =>
  Number.isNaN(code) || code === 0x20 || code === 0x0a || code === 0x09;

// `~text~`: one tilde on each side, no space just inside either.
function strikeSingle(state: StateInline, silent: boolean) {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== 0x7e) return false;
  if (src.charCodeAt(pos + 1) === 0x7e || (pos > 0 && src.charCodeAt(pos - 1) === 0x7e))
    return false;
  if (pos + 1 >= posMax || isSpace(src.charCodeAt(pos + 1))) return false;
  let end = pos + 2;
  while (end < posMax && src.charCodeAt(end) !== 0x7e) end++;
  if (end >= posMax || src.charCodeAt(end + 1) === 0x7e || isSpace(src.charCodeAt(end - 1))) {
    return false;
  }
  if (silent) return true;

  const open = state.push("s_open", "s", 1);
  open.markup = "~";
  const oldMax = state.posMax;
  state.pos = pos + 1;
  state.posMax = end;
  state.md.inline.tokenize(state);
  state.posMax = oldMax;
  const close = state.push("s_close", "s", -1);
  close.markup = "~";
  state.pos = end + 1;
  return true;
}

// `$$` alone on a line, the TeX, and `$$` alone on a line; or all three
// on one line.
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const lineText = (n: number) =>
    state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  const first = lineText(startLine).trim();
  if (!first.startsWith("$$")) return false;
  let content: string;
  let nextLine: number;
  if (first.length > 4 && first.endsWith("$$")) {
    content = first.slice(2, -2).trim();
    nextLine = startLine + 1;
  } else if (first === "$$") {
    let n = startLine + 1;
    while (n < endLine && lineText(n).trim() !== "$$") n++;
    if (n >= endLine) return false;
    content = state.getLines(startLine + 1, n, state.blkIndent, false).replace(/\n$/, "");
    nextLine = n + 1;
  } else {
    return false;
  }
  if (silent) return true;
  const token = state.push("fm_math_block", "div", 0);
  token.content = content;
  token.map = [startLine, nextLine];
  state.line = nextLine;
  return true;
}

// `$…$` with no space just inside either dollar, nothing after the
// closing one that could be a price, and no dollar in between.
function mathInline(state: StateInline, silent: boolean) {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== 0x24 /* $ */ || src.charCodeAt(pos + 1) === 0x24) return false;
  if (pos + 1 >= posMax || isSpace(src.charCodeAt(pos + 1))) return false;
  let end = pos + 2;
  while (end < posMax && src.charCodeAt(end) !== 0x24) end++;
  if (end >= posMax || isSpace(src.charCodeAt(end - 1))) return false;
  const after = src.charCodeAt(end + 1);
  if (after >= 0x30 && after <= 0x39) return false;
  if (!silent) {
    const token = state.push("fm_math_inline", "span", 0);
    token.content = src.slice(pos + 1, end);
  }
  state.pos = end + 1;
  return true;
}

// A quote whose first paragraph starts with `[!KIND]` on its own line.
function alerts(state: StateCore) {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    const paragraph = tokens[i + 1];
    const inline = tokens[i + 2];
    if (paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;
    const m = ALERT_LINE.exec(inline.content);
    if (!m) continue;
    tokens[i].attrSet("data-alert", m[1].toLowerCase());
    inline.content = inline.content.slice(m[0].length);
    if (inline.content === "") tokens.splice(i + 1, 3);
  }
}
