# Comment-syntax notes

When you write `<!-- something -->`, the closing sequence `-->` is what tells a parser the comment ends.

That sequence — `-->` — appears in some prose around HTML, but inside a YAML literal you'd otherwise rebuild it (which the format spec calls out).

The opener <!-- fmc:1 -->`<!--`<!-- /fmc:1 --> deserves similar care: it can drift into prose when discussing syntax.

<!-- forgemark-comments
- id: 1
  anchor_text: "`<!\\--`"
  context_before: "The opener"
  context_after: "deserves similar care"
  author: Maya
  timestamp: 2026-05-08T14:00:00Z
  resolved: false
  body: |
    Worth showing both the opener and closer in the same paragraph; readers expect the symmetry.
-->
