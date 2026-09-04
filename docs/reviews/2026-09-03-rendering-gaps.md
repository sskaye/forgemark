# What Forgemark does not render

Date: 2026-09-03. Branch: `feature/agent-cli`.

## The two standards

**Markdown: GitHub Flavored Markdown, as github.com shows it.** The GFM spec (CommonMark plus tables, task lists, strikethrough, autolinks, and the tag filter) is the baseline. On top of the spec, github.com renders a handful of extras that people write for: alerts (`> [!NOTE]`), footnotes, `$…$` math, Mermaid fences, `:emoji:` shortcodes, syntax-highlighted code, heading anchors, and `<details>`. Since the files under review are read on GitHub as often as in Forgemark, "what GitHub shows" is the target, not the bare spec.

**HTML: the page as a browser shows it.** There is no narrower standard worth aiming at. A generated report is HTML, CSS, and JavaScript, and the reasonable expectation is that Forgemark shows what Chrome or Safari shows when the file is opened, with the review layer on top. Forgemark today implements a strict subset: static markup and inline CSS, no script, no external resources.

## How this was checked

- A 45-construct GFM sample was run through the real editor pipeline (`renderedExtensions()` plus the block sync) in a throwaway test, recording what displays and what the edited-block serializer writes back.
- The HTML view's design notes, sandbox flags, and the app's Content Security Policy were read.
- `~/software_dev/qs_tracker/reports/dashboard.html` was inventoried.

Unedited Markdown blocks are written back byte for byte, so every Markdown gap below is either display-only or bites only on the block being edited. The lists are grouped by that distinction.

## Markdown

### A. Source damaged when the block is edited

Typing in a paragraph that contains one of these rewrites the paragraph without it. These are the ones worth fixing first: a reviewer who corrects a typo should not lose markup.

1. **Inline HTML tags the editor has no node or mark for are stripped.** `<kbd>`, `<mark>`, `<ins>`, `<abbr>`, `<span>`, `<cite>`, `<small>`, `<u>`, `<video>`, `<audio>`. They display as plain text (GitHub styles them) and the tags are gone after an edit. A `<video>` alone on its line is inline HTML in a paragraph and vanishes entirely. `<sub>`, `<sup>`, `<del>`, and `<br>` survive.
2. **Inline HTML comments are dropped.** `text <!-- note --> more` comes back as `text more`. Only Forgemark's own marker comments are kept.
3. **GitHub alerts.** `> [!NOTE]` shows as an ordinary quote with the literal `[!NOTE]` text, and comes back as `> \[!NOTE\]`, which GitHub then shows as literal text too.
4. **Footnotes.** `Claim[^1].` and `[^1]: The note.` display as literal text and come back as `Claim\[^1\].` and `\[^1\]: The note.`, so the footnote is lost.
5. **Single-tilde strikethrough.** GFM allows `~text~`; it displays as literal tildes and comes back as `\~text\~`.
6. **An image inside a link.** `[![badge](img.svg)](https://x.y)` displays the image without the link, preceded by an empty paragraph, and serializes without the link. The editor's image is a block node, so nothing inline can wrap it.
7. **Escaped pipes in table cells.** `\|` displays as a pipe but serializes as a bare `|`, which splits the cell.

### B. Displayed differently from GitHub, source intact

8. **Bare URLs, `www.` addresses, and e-mail addresses are not links.** This is deliberate: autolinking was turned off because `SKILL.md` and similar became links to the `.md` top-level domain. GitHub links them. A stricter rule (a scheme or `www.` required, and no bare filenames) would restore the common case.
9. **No syntax highlighting** in fenced code blocks.
10. **Mermaid fences show as code**, `$…$` and `$$` math show as literal text, and `:tada:` shortcodes show as text.
11. **`<details>` and `<summary>`** show as two raw-HTML placeholders with the body between them, instead of a collapsible section.
12. **An `<img>` tag with `width` or `height`** (the usual way to size an image on GitHub) shows as a raw-HTML placeholder; the image itself is not displayed.
13. **Relative image paths do not load.** `![](images/pic.png)` resolves against the app's own origin instead of the file's folder. Only absolute `https:` and `data:` images display. The Content Security Policy already allows the Tauri asset protocol; nothing converts the path.
14. **In-document and relative links are dead.** Headings get no ids, so `[x](#heading)` has nowhere to go, and the click handler prevents the default and only opens `http`, `https`, and `mailto`. A table of contents does nothing, and `[doc](./other.md)` neither opens the file nor a new tab.
15. **Wide tables squeeze instead of scrolling.** Tables are forced to full width with no scrolling container, so twelve columns become unreadable. GitHub scrolls them. Code blocks do scroll.

### C. Normalized when the block is edited

GitHub renders the result the same; only the source churns. Listed so nobody mistakes them for damage.

- Two-space hard breaks become `\`; `~~~` fences become backticks; indented code becomes fenced; setext headings become `#`; `***` and `___` rules become `---`.
- A task list comes back loose (blank lines between items).
- `&copy;` becomes `©`; table alignment markers (`:-:`) are dropped; reference links are inlined; wrapped paragraphs are unwrapped.
- A `$$` block on three lines collapses to one line.

## HTML reports

A report is written into an iframe with `sandbox="allow-same-origin"` and no `allow-scripts`, and the app's Content Security Policy applies inside it (a frame with no URL of its own inherits the host's policy). Everything below follows from those two facts.

1. **Scripts never run, so a report built by script is empty.** `dashboard.html` is 1.77 MB, of which 1.75 MB is script and 5.9 KB is markup: the tab strip, the range and date controls, and empty containers such as `<div id="agp">`. Every tile, chart, caption, and SVG is created by script at load. Forgemark shows the header and the empty shell, and the tabs, select, and date inputs do nothing. Tabs are the symptom; the class is any report that renders from embedded data or a bundled library (Plotly, Chart.js, D3, script-toggled panels, `<canvas>`).
   - Adding `allow-scripts` alone would not help: `script-src 'self'` in the policy blocks inline script. Both layers would need to change, and `allow-scripts` together with `allow-same-origin` gives the report access to the host, which is why the sandbox comment in `HtmlView.tsx` rules it out. The workable shapes are a separate-origin frame that talks to Forgemark by message, or rendering once and snapshotting the DOM. That is a design decision, not a gap to list.
   - A side effect: `<noscript>` content is shown (scripting is off) but skipped by the text map, so it cannot be commented on.
2. **Anything hidden cannot be reviewed.** Panels with `hidden` or `display: none` (the dashboard's non-active tabs and custom-range inputs), `<template>` content, and anything revealed by a click are invisible and unreachable. Script-free interaction that the browser handles itself works: `<details>`, hover styles, checkbox-driven CSS.
3. **External resources are blocked.** `style-src 'self'` blocks `<link rel="stylesheet" href="https://…">` and `@import`; `font-src 'self' data:` blocks web fonts, Google Fonts included; CDN scripts are blocked twice over. Remote `https:` images load, `http:` ones do not.
4. **Sibling files do not resolve.** `styles.css`, `chart.png`, or `data.json` next to the report resolve against the app's origin, not the file's folder, the same defect as relative images in Markdown. A report is only shown right if it is self-contained: inline CSS and `data:` images.
5. **Links inside a report do nothing at all**, external and in-page alike. The click is cancelled so the frame cannot navigate away from the document under review, and nothing opens the target elsewhere. Markdown at least opens external links.
6. **Layout that assumes a scrolling window breaks.** The frame is sized to its content and the pane scrolls, so `position: sticky` and `position: fixed` (the dashboard uses both) do not stick, and `100vh` means the frame's full height rather than the visible area.
7. **Theme handling is right.** `data-theme` is set on the root and `prefers-color-scheme` follows the system, so a report that honours either renders in the right palette. Self-contained static reports, like the bundled example, render correctly.

## Reading the two lists together

Three defects are the same problem in both formats: relative paths never resolve against the file's folder (Markdown 13, HTML 4), links to other places do nothing (Markdown 14, HTML 5), and markup the editor does not model is either stripped or shown raw (Markdown 1, 11, 12). The script question (HTML 1) is the largest single gap and the only one that needs a design decision before any code.
