# Manual test script

Files in this folder exercise what cannot be tested under jsdom: the rendered Markdown view and the report frame in the real app. Run `npm run dev`, then work through the steps. Each step says what to expect; anything else is a finding.

## Part 1 — Markdown: `gfm-showcase.md`

Open `docs/example_file/testing/gfm-showcase.md`.

1. **Inline HTML.** The `Ctrl` and `C` keys look like keycaps, "highlighted" has a mark, "inserted" is underlined, the red span is red, the comment and word break are invisible. The small swatch and the linked badge sit inline in their sentences.
2. **Edit survives.** Click at the end of the "Press Ctrl+C…" paragraph, type ` Done.`, then open Source view (⌘⇧S or the view switch). The `<kbd>`, `<mark>`, `<abbr title>`, `<span style>`, `<!-- an inline comment -->`, and `<wbr>` are all still there, and only that paragraph changed.
3. **Raw HTML blocks.** The centred swatch shows centred at 200 px wide. The HTML table renders as a table. The details block shows its summary and body. The block comment shows as a quiet "HTML comment" placeholder.
4. **Alerts.** "Note" and "Warning" quotes carry a coloured label and rail; the plain quote does not. Type into the note and check in Source view that `> [!NOTE]` is still the first line.
5. **Footnotes and tildes.** `[1]` and `[note]` appear as small superscripts; the two definitions render with their labels beside them. "one tilde" and "two" are both struck; the lone `~` and `$5` are plain. Type into the sentence and confirm in Source view that `[^1]`, `[^note]`, and `\$5` (an escaped dollar is fine) come back intact.
6. **Links.** The three addresses are links and the two non-addresses are not. Click the `https://example.com` link: it opens in your browser. Click "the second heading" at the top: the view scrolls to Inline HTML. Click "the linked document": `linked.md` opens in a new tab; its "back" link returns to the showcase tab.
7. **Tables.** The pipe cells show `x | y` and `a|b`. Type into any cell, then check Source view: `\|` is still escaped in both. The wide table scrolls sideways instead of squeezing.
8. **Code.** The Python block is coloured; the block with no language is plain.
9. **Math and diagram.** The inline formula, the `$$` block, and the ```` ```math ```` block are typeset. The Mermaid block draws a flowchart after a moment.
10. **Print.** File → Print: the print preview shows the same rendering, images included.

## Part 2 — HTML report: `dashboard/dashboard.html`

Open `docs/example_file/testing/dashboard/dashboard.html`. Everything below the header is drawn by the report's script from `data.json`, and the stylesheet and logo are files beside it.

1. **It runs.** The logo shows top left, the page is styled (cards, tiles), three tiles and a line chart appear, and the footer shows today's date. The header stays stuck to the top when you scroll.
2. **It is interactive.** Click the Sleep tab: tiles and chart change. Change Range to Week: the chart redraws with 7 points.
3. **Inline anchor on static text.** Select "Variable projection" in the Notes card and press ⌘⌥M (or use the toolbar that appears). Add a comment. Expect: the passage is highlighted, the report did not reload (the Sleep tab is still selected), and the file on disk (Source view) has `<!-- fmc:1 -->` around the words in the source.
4. **Passage anchor on generated text.** On the Sleep tab, select the value in the "Deep sleep" tile and comment. Expect: the composer offers Comment only (no suggestion), the card shows the quoted value, Source view shows `anchor_kind: passage` with `anchor_selector: "#tiles"` and the markers around `<section class="tiles" id="tiles"></section>`. The value stays highlighted. Switch to Glucose and back to Sleep: the highlight comes back on the redrawn tile.
5. **Element anchor on a generated chart.** Hover the line chart: a Comment button sits beside it. Click it and comment. Expect: the whole chart carries an accent rail, and the file anchors `#chart` (`anchor_kind: passage` or `element`, selector `#chart`).
6. **Element anchor on a static figure.** Click the Comment button beside Figure 1 and comment. Expect: `anchor_kind: element`, `anchor_selector: "#fig-static"`, markers directly around the `<figure>` in the source.
7. **Floating fallback.** Select part of the footer date ("Generated report" is static; the date is generated and inside no element with an id except the span). Comment on the date. Expect: a floating note that still shows the date as its quoted text, and no markers added to the file.
8. **Delete without reload.** Delete the comment from step 3 in the sidebar. Expect: the highlight disappears, the markers are gone from the source, and the report did not reload.
9. **Right-click.** Select "eliminates the linear block" and right-click it: the New Comment / Suggest Edit menu opens. Escape closes it.
10. **Links inside the report.** In the intro paragraph, click "an address": it opens in the browser. Click "the notes section": the frame scrolls to Notes. Click "the Markdown showcase": `gfm-showcase.md` opens in a new tab.
11. **Source view and back.** Switch to Source view, then back to the rendered view: the report is still on the tab you left it on.
12. **Card to anchor.** Click a comment card in the sidebar: the frame scrolls to its highlight.
13. **Theme.** Switch the app to dark mode (Settings): the report follows, since its stylesheet has a dark palette.
14. **Reload from disk.** With the file open, edit `data.json` in another editor (change a tile label) and save `dashboard.html` untouched — nothing should happen. Then touch `dashboard.html` itself (add a space to the intro paragraph and save): the app offers to reload, and after reloading the report is drawn fresh.

## Part 3 — Round trip

After Part 2, open the saved `dashboard.html` in a browser directly. It should render and work exactly as before; the markers are invisible comments. Run `npm run cli -- lint docs/example_file/testing/dashboard/dashboard.html`: no problems.
