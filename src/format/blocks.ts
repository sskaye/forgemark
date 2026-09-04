// Top-level blocks of a Markdown body, with their source lines.
//
// The rendered editor cannot hold the author's Markdown as written:
// run a document through it and hard wraps unwrap, reference links are
// inlined, HTML comments disappear. So the editor never gets to
// rewrite the whole document. The body is split into blocks here, one
// per top-level markdown-it token, and the editor shows one node per
// block; when the reader types, only the blocks whose nodes changed are
// re-serialized and spliced back into their own lines
// (`spliceBlocks`), and every other byte stays as it was.
//
// Two kinds of block:
//
//   - "markdown": something the editor can hold — a paragraph, heading,
//     list, quote, table, fenced or indented code, rule. Editing one
//     normalizes that block alone.
//   - "verbatim": raw HTML (a comment, a <div>, a <details>). The editor
//     would drop or mangle it, so it is shown as a read-only placeholder
//     and written back exactly.
//
// A whole-code-block anchor — marker lines on their own around a fence
// — is one block, so the editor sees one anchored code block.

import MarkdownIt from "markdown-it";

export type SourceBlock = {
  // Line range, end exclusive, into the body's lines. Trailing blank
  // lines belong to the gap that follows, not to the block.
  start: number;
  end: number;
  text: string;
  kind: "markdown" | "verbatim";
};

export type BlockMap = { lines: string[]; blocks: SourceBlock[] };

const md = new MarkdownIt({ html: true, linkify: false });

const OPEN_MARKER_LINE = /^\s*<!--\s*fmc:(\d+)\s*-->\s*$/;
const CLOSE_MARKER_LINE = /^\s*<!--\s*\/fmc:(\d+)\s*-->\s*$/;

// A marker at the start of a line would begin an HTML block in
// CommonMark and cut the paragraph it sits in. For finding block
// boundaries, inline markers are made harmless (`<!__` is neither a
// comment nor a tag); markers alone on a line are left, since those are
// the whole-code-block form the loop below merges.
function forTokenizing(lines: string[]): string {
  return lines
    .map((line) =>
      OPEN_MARKER_LINE.test(line) || CLOSE_MARKER_LINE.test(line)
        ? line
        : line.replace(/<!--(\s*\/?fmc:\d+\s*)-->/g, "<!__$1-->"),
    )
    .join("\n");
}

export function splitBlocks(body: string): BlockMap {
  const lines = body === "" ? [] : body.split("\n");
  type Tok = { type: string; map: [number, number] | null; level: number };
  const tokens = (md.parse(forTokenizing(lines), {}) as Tok[]).filter(
    (t) => t.level === 0 && t.map && !t.type.endsWith("_close"),
  );

  const raw: SourceBlock[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const [s, e0] = t.map as [number, number];
    let e = e0;
    // markdown-it's map for a list runs through the blank line after it;
    // give the blank back to the gap so a rewritten list keeps its
    // spacing.
    while (e > s + 1 && lines[e - 1].trim() === "") e--;
    const text = lines.slice(s, e).join("\n");

    // `<!-- fmc:N -->` / fence / `<!-- /fmc:N -->` on consecutive lines:
    // one anchored code block.
    if (t.type === "html_block" && OPEN_MARKER_LINE.test(text)) {
      const fence = tokens[i + 1];
      const close = tokens[i + 2];
      if (
        fence?.type === "fence" &&
        close?.type === "html_block" &&
        fence.map![0] === e &&
        close.map![0] === fence.map![1]
      ) {
        const closeText = lines.slice(close.map![0], close.map![1]).join("\n");
        const openId = OPEN_MARKER_LINE.exec(text)?.[1];
        const closeId = CLOSE_MARKER_LINE.exec(closeText.trimEnd())?.[1];
        if (openId !== undefined && openId === closeId) {
          let ce = close.map![1];
          while (ce > close.map![0] + 1 && lines[ce - 1].trim() === "") ce--;
          raw.push({ start: s, end: ce, text: lines.slice(s, ce).join("\n"), kind: "markdown" });
          i += 2;
          continue;
        }
      }
    }
    raw.push({ start: s, end: e, text, kind: t.type === "html_block" ? "verbatim" : "markdown" });
  }
  return { lines, blocks: raw };
}

// Replace blocks [from, to) with new Markdown, and return the new body.
// `to === from` inserts before block `from` (or after the last block when
// `from` is the block count); empty `replacement` removes the blocks.
export function spliceBlocks(map: BlockMap, from: number, to: number, replacement: string): string {
  const { lines, blocks } = map;
  const repl = replacement.replace(/\n+$/, "");
  const replLines = repl === "" ? [] : repl.split("\n");

  if (to > from) {
    const startLine = blocks[from].start;
    const endLine = blocks[to - 1].end;
    const out = [...lines.slice(0, startLine), ...replLines, ...lines.slice(endLine)];
    return collapseGap(out, startLine, replLines.length === 0).join("\n");
  }

  // Insertion.
  if (from >= blocks.length) {
    const last = blocks[blocks.length - 1];
    const at = last ? last.end : 0;
    const tail = lines.slice(at);
    const before = lines.slice(0, at);
    const sep = before.length === 0 ? [] : [""];
    return [...before, ...sep, ...replLines, ...tail].join("\n");
  }
  const at = blocks[from].start;
  return [...lines.slice(0, at), ...replLines, "", ...lines.slice(at)].join("\n");
}

// After removing a block, the blank line before it and the blank line
// after it meet; keep one.
function collapseGap(lines: string[], at: number, removed: boolean): string[] {
  if (!removed) return lines;
  if (at > 0 && at < lines.length && lines[at - 1].trim() === "" && lines[at].trim() === "") {
    return [...lines.slice(0, at), ...lines.slice(at + 1)];
  }
  return lines;
}
