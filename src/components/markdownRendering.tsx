import { Node, mergeAttributes, nodeInputRule, type Editor, type Extensions } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import katex from "katex";
import { AnchorMark } from "./AnchorMark";
import { CodeBlockAnchor } from "./CodeBlockAnchor";
import "katex/dist/katex.min.css";

type CreateMarkdownExtensionsOptions = {
  documentPath?: string | null;
  extraExtensions?: Extensions;
};

type SerializerState = {
  write(text: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: unknown): void;
  renderContent(node: unknown): void;
  wrapBlock(delim: string, firstDelim: string | null, node: unknown, callback: () => void): void;
};

type TextNode = {
  attrs: { tex: string };
  textContent: string;
};

type MarkdownToken = {
  content: string;
  markup?: string;
  map?: [number, number];
  block?: boolean;
  meta?: Record<string, string>;
};

type MarkdownInlineState = {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): MarkdownToken;
};

type MarkdownBlockState = {
  src: string;
  bMarks: number[];
  tShift: number[];
  eMarks: number[];
  sCount: number[];
  blkIndent: number;
  line: number;
  parentType: string;
  push(type: string, tag: string, nesting: number): MarkdownToken;
};

type MarkdownItLike = {
  inline: {
    ruler: {
      after(name: string, ruleName: string, rule: MarkdownInlineRule): void;
      before(name: string, ruleName: string, rule: MarkdownInlineRule): void;
    };
  };
  block: {
    ruler: {
      before(
        name: string,
        ruleName: string,
        rule: MarkdownBlockRule,
        options?: { alt?: string[] },
      ): void;
    };
  };
  renderer: {
    rules: Record<string, ((tokens: MarkdownToken[], idx: number) => string) | undefined>;
  };
  __forgemarkMath?: boolean;
  __forgemarkWiki?: boolean;
};

type MarkdownInlineRule = (state: MarkdownInlineState, silent: boolean) => boolean;
type MarkdownBlockRule = (
  state: MarkdownBlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

// GitHub recognizes five callout types; Obsidian allows arbitrary ones
// (e.g. [!Takeaway], [!Executive Summary]). Match any non-empty type plus
// an optional fold marker (+/-) so Obsidian vault notes render too — the
// five known types get themed styling, the rest fall back to a neutral
// "generic" callout that still shows their label.
const CALLOUT_RE = /^\s*\[!([^\]\r\n]+)\][-+]?[ \t]*(?:\r?\n)?/;
// Markdown image syntax `![alt](src "optional title")`, anchored to the end
// of the just-typed text so it fires the moment the closing `)` is typed.
const IMAGE_INPUT_RE = /(?:^|\s)(!\[(.+|:?)\]\((\S+)(?:\s+["'](.+?)["'])?\))$/;
const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_RE = /^[a-z]:[\\/]/i;

const KNOWN_CALLOUT_TYPES = new Set(["note", "tip", "important", "warning", "caution"]);
const KNOWN_CALLOUT_LABELS: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};
// Obsidian image/embed wikilink targets we render: only image files (note
// and PDF embeds are left untouched). Matched against the target path.
const WIKI_IMAGE_EXT_RE = /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i;

// Subscript / superscript marks. StarterKit ships neither, so `<sub>` /
// `<sup>` tags would otherwise be dropped to plain text on parse and lost
// on the next save.
const SubscriptMark = Subscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sub>", close: "</sub>", expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

const SuperscriptMark = Superscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sup>", close: "</sup>", expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

const GithubCallout = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      calloutType: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-callout-type"),
        renderHTML: (attrs: { calloutType: string | null }) => {
          const raw = attrs.calloutType;
          const key = calloutClassKey(raw);
          if (!key || !raw) return {};
          return {
            class: `fm-callout fm-callout-${key}`,
            "data-callout-type": raw,
            "data-callout-label": calloutLabel(raw),
          };
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { attrs: { calloutType: string | null } }) {
          const raw = node.attrs.calloutType;
          if (!raw) {
            state.wrapBlock("> ", null, node, () => state.renderContent(node));
            return;
          }
          // Preserve the type verbatim so Obsidian types (e.g. "Takeaway",
          // "Executive Summary") round-trip exactly rather than being
          // upper-cased or dropped.
          state.wrapBlock("> ", null, node, () => {
            state.write(`[!${raw}]`);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: {
          updateDOM(element: HTMLElement) {
            normalizeGithubCalloutDOM(element);
          },
        },
      },
    };
  },
});

const MarkdownImage = Image.extend<ImageOptions & { documentPath: string | null }>({
  addOptions() {
    const parent = this.parent?.();
    return {
      inline: parent?.inline ?? false,
      allowBase64: parent?.allowBase64 ?? false,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      resize: parent?.resize ?? false,
      documentPath: null,
    };
  },

  // Obsidian embeds (`![[file.svg]]`) are parsed into image nodes that
  // remember they were wikilinks so they serialize back to `![[...]]`
  // instead of standard `![](...)`. wikitarget keeps the author's original
  // target (folder/fragment and all) for an exact round-trip.
  addAttributes() {
    return {
      ...this.parent?.(),
      wikilink: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-wikilink") === "true",
        renderHTML: (attrs: { wikilink?: boolean }) =>
          attrs.wikilink ? { "data-wikilink": "true" } : {},
      },
      wikitarget: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-wikitarget"),
        renderHTML: (attrs: { wikitarget?: string | null }) =>
          attrs.wikitarget ? { "data-wikitarget": attrs.wikitarget } : {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src;
    const renderedSrc =
      typeof src === "string" ? resolveMarkdownImageSrc(src, this.options.documentPath) : src;
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: renderedSrc }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: SerializerState,
          node: {
            attrs: {
              wikilink?: boolean;
              wikitarget?: string | null;
              src?: string | null;
              alt?: string | null;
              title?: string | null;
            };
          },
        ) {
          const { wikilink, wikitarget, src, alt, title } = node.attrs;
          if (wikilink && wikitarget) {
            state.write(`![[${wikitarget}]]`);
            return;
          }
          // Standard image syntax (mirrors tiptap-markdown's default, which
          // this override replaces for the image node).
          const altText = typeof alt === "string" ? alt : "";
          const titlePart = title ? ` "${String(title).replace(/"/g, '\\"')}"` : "";
          state.write(`![${altText}](${src ?? ""}${titlePart})`);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installWikiEmbeds(markdownit);
          },
        },
      },
    };
  },

  // Without an input rule, typing `![alt](path)` in the rendered editor
  // stays as literal text (tiptap-markdown only converts image syntax on
  // paste / initial load), so figures never appear until the next reload.
  // This converts the markdown image syntax to an image node as it's typed.
  addInputRules() {
    return [
      nodeInputRule({
        find: IMAGE_INPUT_RE,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;
          return { src, alt, title };
        },
      }),
    ];
  },
});

// Math nodes are atoms: clicking one selects it as a NodeSelection.
// Backspace/Delete then need to remove it — the default keymap doesn't
// reliably delete a selected inline atom, leaving users (per bug report)
// unable to remove an equation. This handler deletes the node whenever
// it's the current selection.
function deleteSelectedMath(editor: Editor, name: string): boolean {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === name) {
    return editor.commands.deleteSelection();
  }
  return false;
}

const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteSelectedMath(this.editor, this.name),
      Delete: () => deleteSelectedMath(this.editor, this.name),
    };
  },

  addAttributes() {
    return {
      tex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-tex") ?? el.textContent ?? "",
        renderHTML: (attrs: { tex: string }) => ({ "data-tex": attrs.tex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: TextNode) {
          state.write(`$${escapeMathText(node.attrs.tex)}$`);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installMathMarkdown(markdownit);
          },
        },
      },
    };
  },
});

const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteSelectedMath(this.editor, this.name),
      Delete: () => deleteSelectedMath(this.editor, this.name),
    };
  },

  addAttributes() {
    return {
      tex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-tex") ?? el.textContent ?? "",
        renderHTML: (attrs: { tex: string }) => ({ "data-tex": attrs.tex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: TextNode) {
          state.ensureNewLine();
          state.write("$$\n");
          state.text(node.attrs.tex, false);
          state.ensureNewLine();
          state.write("$$");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installMathMarkdown(markdownit);
          },
        },
      },
    };
  },
});

export function createMarkdownExtensions({
  documentPath = null,
  extraExtensions = [],
}: CreateMarkdownExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({ link: false, codeBlock: false, blockquote: false }),
    GithubCallout,
    CodeBlockAnchor,
    Link.configure({ openOnClick: false }),
    SubscriptMark,
    SuperscriptMark,
    AnchorMark,
    ...extraExtensions,
    MarkdownImage.configure({ documentPath }),
    InlineMath,
    BlockMath,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({
      // html: true is what allows the anchor `<span>` wrappers we inject
      // to survive the markdown-to-ProseMirror round-trip.
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

export function resolveMarkdownImageSrc(src: string, documentPath: string | null): string {
  if (!src || src.startsWith("#") || src.startsWith("//")) return src;
  const { pathPart, suffix } = splitAssetSuffix(src);
  if (!pathPart) return src;

  const filePath = resolveLocalImagePath(pathPart, documentPath);
  if (!filePath) return src;

  const internals =
    typeof window === "undefined"
      ? null
      : (window as typeof window & { __TAURI_INTERNALS__?: { convertFileSrc?: unknown } })
          .__TAURI_INTERNALS__;
  if (typeof internals?.convertFileSrc !== "function") return src;

  try {
    return convertFileSrc(filePath) + suffix;
  } catch {
    return src;
  }
}

function InlineMathView({ node }: NodeViewProps) {
  const tex = String(node.attrs.tex ?? "");
  return (
    <NodeViewWrapper
      as="span"
      className="fm-math fm-math-inline"
      data-tex={tex}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: renderKatex(tex, false) }}
    />
  );
}

function BlockMathView({ node }: NodeViewProps) {
  const tex = String(node.attrs.tex ?? "");
  return (
    <NodeViewWrapper
      className="fm-math fm-math-block"
      data-tex={tex}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: renderKatex(tex, true) }}
    />
  );
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch {
    return escapeHtml(tex);
  }
}

// Obsidian image embeds: `![[target]]`, `![[target|alias]]`,
// `![[target|width]]`. We render them as <img> HTML (picked up by the
// MarkdownImage node via html:true), resolving by basename — mirroring
// Obsidian's filename-based vault resolution — relative to the document.
function installWikiEmbeds(markdownit: MarkdownItLike) {
  if (markdownit.__forgemarkWiki) return;
  markdownit.__forgemarkWiki = true;
  markdownit.inline.ruler.before("image", "forgemark_wikiembed", wikiEmbedRule);
  markdownit.renderer.rules.forgemark_wikiembed = (tokens, idx) => {
    const meta = tokens[idx].meta ?? {};
    return (
      `<img data-wikilink="true"` +
      ` data-wikitarget="${escapeHtmlAttribute(meta.target ?? "")}"` +
      ` src="${escapeHtmlAttribute(meta.src ?? "")}"` +
      ` alt="${escapeHtmlAttribute(meta.alt ?? "")}">`
    );
  };
}

function wikiEmbedRule(state: MarkdownInlineState, silent: boolean): boolean {
  const start = state.pos;
  if (
    state.src.charCodeAt(start) !== 0x21 /* ! */ ||
    state.src.charCodeAt(start + 1) !== 0x5b /* [ */ ||
    state.src.charCodeAt(start + 2) !== 0x5b /* [ */
  ) {
    return false;
  }
  const close = state.src.indexOf("]]", start + 3);
  if (close < 0) return false;
  const inner = state.src.slice(start + 3, close);
  if (inner.length === 0 || inner.includes("[")) return false;

  // `target|alias|width` — strip a `#heading` fragment from the target.
  // Only image targets are handled; note/PDF embeds are left to fall
  // through (so they aren't silently swallowed).
  const parts = inner.split("|");
  const target = parts[0].trim();
  const pathOnly = target.split("#")[0].trim();
  if (!WIKI_IMAGE_EXT_RE.test(pathOnly)) return false;

  if (!silent) {
    const alias = parts
      .slice(1)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !/^\d+$/.test(p));
    const base = pathOnly.split(/[\\/]/).pop() ?? pathOnly;
    const token = state.push("forgemark_wikiembed", "img", 0);
    token.meta = { target, src: base, alt: alias ?? base };
  }
  state.pos = close + 2;
  return true;
}

function installMathMarkdown(markdownit: MarkdownItLike) {
  if (markdownit.__forgemarkMath) return;
  markdownit.__forgemarkMath = true;
  markdownit.inline.ruler.after("escape", "forgemark_math_inline", mathInlineRule);
  markdownit.block.ruler.before("fence", "forgemark_math_block", mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  markdownit.renderer.rules.forgemark_math_inline = (tokens, idx) =>
    `<span data-math-inline="true" data-tex="${escapeHtmlAttribute(tokens[idx].content)}"></span>`;
  markdownit.renderer.rules.forgemark_math_block = (tokens, idx) =>
    `<div data-math-block="true" data-tex="${escapeHtmlAttribute(tokens[idx].content)}"></div>`;
}

function mathInlineRule(state: MarkdownInlineState, silent: boolean): boolean {
  const start = state.pos;
  if (state.src[start] !== "$" || state.src[start + 1] === "$") return false;
  if (start > 0 && state.src[start - 1] === "\\") return false;

  let pos = start + 1;
  while (pos < state.src.length) {
    pos = state.src.indexOf("$", pos);
    if (pos < 0) return false;
    if (state.src[pos - 1] === "\\") {
      pos += 1;
      continue;
    }
    if (pos === start + 1) return false;
    if (!silent) {
      const token = state.push("forgemark_math_inline", "span", 0);
      token.content = state.src.slice(start + 1, pos);
      token.markup = "$";
    }
    state.pos = pos + 1;
    return true;
  }
  return false;
}

function mathBlockRule(
  state: MarkdownBlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.parentType === "blockquote") return false;
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const firstLine = state.src.slice(start, max);
  if (!firstLine.startsWith("$$")) return false;

  const afterOpen = firstLine.slice(2);
  const sameLineClose = findClosingMathDelimiter(afterOpen);
  if (sameLineClose >= 0) {
    if (!silent) {
      const token = state.push("forgemark_math_block", "div", 0);
      token.block = true;
      token.markup = "$$";
      token.content = afterOpen.slice(0, sameLineClose).trim();
      token.map = [startLine, startLine + 1];
    }
    state.line = startLine + 1;
    return true;
  }

  const lines: string[] = [];
  if (afterOpen.trim().length > 0) lines.push(afterOpen);
  let nextLine = startLine + 1;
  for (; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    const close = findClosingMathDelimiter(line);
    if (close >= 0) {
      if (line.slice(0, close).trim().length > 0) lines.push(line.slice(0, close));
      if (!silent) {
        const token = state.push("forgemark_math_block", "div", 0);
        token.block = true;
        token.markup = "$$";
        token.content = lines.join("\n").trim();
        token.map = [startLine, nextLine + 1];
      }
      state.line = nextLine + 1;
      return true;
    }
    lines.push(line);
  }

  return false;
}

function findClosingMathDelimiter(text: string): number {
  let pos = 0;
  while (pos < text.length) {
    pos = text.indexOf("$$", pos);
    if (pos < 0) return -1;
    if (pos === 0 || text[pos - 1] !== "\\") return pos;
    pos += 2;
  }
  return -1;
}

function normalizeGithubCalloutDOM(root: HTMLElement) {
  root.querySelectorAll("blockquote").forEach((blockquote) => {
    const firstBlock = blockquote.firstElementChild;
    if (!firstBlock) return;
    const firstText = firstBlock.firstChild;
    if (!firstText || firstText.nodeType !== globalThis.Node.TEXT_NODE || !firstText.textContent) {
      return;
    }
    const match = CALLOUT_RE.exec(firstText.textContent);
    if (!match) return;
    const rawType = match[1].trim();
    if (rawType.length === 0) return;
    firstText.textContent = firstText.textContent.slice(match[0].length);
    if (firstText.textContent.length === 0) firstText.parentNode?.removeChild(firstText);
    if (isEmptyElement(firstBlock)) firstBlock.remove();
    if (blockquote.children.length === 0) {
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("br"));
      blockquote.append(paragraph);
    }
    blockquote.setAttribute("data-callout-type", rawType);
  });
}

function isEmptyElement(element: Element): boolean {
  return (
    element.textContent?.trim().length === 0 && element.querySelector("img, table, pre") == null
  );
}

// The CSS class suffix for a callout type: one of the five themed types,
// or "generic" for any other (Obsidian) type. Null only for an empty type.
function calloutClassKey(rawType: string | null | undefined): string | null {
  if (!rawType) return null;
  const normalized = rawType.trim().toLowerCase();
  if (normalized.length === 0) return null;
  return KNOWN_CALLOUT_TYPES.has(normalized) ? normalized : "generic";
}

// The human label shown in the callout header: the canonical label for a
// known type, otherwise the author's own type text (e.g. "Takeaway").
function calloutLabel(rawType: string): string {
  const normalized = rawType.trim().toLowerCase();
  return KNOWN_CALLOUT_LABELS[normalized] ?? rawType.trim();
}

function splitAssetSuffix(src: string): { pathPart: string; suffix: string } {
  const queryIndex = src.search(/[?#]/);
  if (queryIndex < 0) return { pathPart: src, suffix: "" };
  return { pathPart: src.slice(0, queryIndex), suffix: src.slice(queryIndex) };
}

function resolveLocalImagePath(src: string, documentPath: string | null): string | null {
  const decoded = decodePath(src);
  if (decoded.startsWith("file:")) return fileUrlToPath(decoded);
  if (WINDOWS_ABSOLUTE_RE.test(decoded) || decoded.startsWith("\\\\") || decoded.startsWith("/")) {
    return decoded;
  }
  if (URL_SCHEME_RE.test(decoded)) return null;
  if (!documentPath) return null;
  const separator = documentPath.includes("\\") ? "\\" : "/";
  const slash = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (slash < 0) return decoded;
  return normalizeLocalPath(documentPath.slice(0, slash), decoded, separator);
}

function normalizeLocalPath(baseDir: string, relativePath: string, separator: string): string {
  const prefixMatch = baseDir.match(/^[a-z]:/i);
  const prefix = prefixMatch ? prefixMatch[0] : baseDir.startsWith(separator) ? separator : "";
  const baseWithoutPrefix = prefixMatch ? baseDir.slice(prefix.length) : baseDir;
  const parts = `${baseWithoutPrefix}${separator}${relativePath}`
    .split(/[\\/]+/)
    .filter((part) => part.length > 0);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  if (prefixMatch) return `${prefix}${separator}${normalized.join(separator)}`;
  return `${prefix}${normalized.join(separator)}`;
}

function fileUrlToPath(src: string): string {
  try {
    const url = new URL(src);
    let path = decodePath(url.pathname);
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    return path;
  } catch {
    return src;
  }
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function escapeMathText(tex: string): string {
  return tex.replace(/\$/g, "\\$");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
