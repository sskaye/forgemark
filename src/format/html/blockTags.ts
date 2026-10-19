// Elements whose edges a reader sees as a break in the text.
//
// A browser lays these out as blocks (or table cells and rows), so the
// text of two neighbours never runs together on the page, even when the
// source has nothing between them: `<td>x</td><td>beta two</td>` reads
// as "x" and "beta two", not "xbeta two". Generated reports are often
// written that way, minified or joined from strings.
//
// Both text models use this one list, so a passage the reader can select
// in the app is a passage the format layer can find in the source: the
// source map (`textmap.ts`) puts a line break at each edge, and the
// report bridge puts a space between text in different blocks when it
// records the words around a selection. Tag-based, like `innerText`
// without the CSS: a report that restyles a `<span>` as a block is not
// seen as one.

export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

// The same list as a CSS selector, for `Element.closest`.
export const BLOCK_SELECTOR = [...BLOCK_TAGS].join(", ");

// An opening or closing tag of one of them, or a `<br>`, in source: the
// places where reading a span of source as text needs a space.
export const BLOCK_EDGE_RE = new RegExp(
  `<\\/?(?:${[...BLOCK_TAGS].join("|")})(?=[\\s/>])[^>]*>|<br(?=[\\s/>])[^>]*>`,
  "gi",
);
