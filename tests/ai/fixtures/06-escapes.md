# Edge cases

Sometimes a body contains the literal HTML-comment opener <!-- fmc:1 -->in a discussion of syntax<!-- /fmc:1 -->.

The arrow shape <!-- fmc:2 -->reads as a transition<!-- /fmc:2 --> in some prose styles.

<!-- forgemark-comments
- id: 1
  anchor_text: "in a discussion of syntax"
  context_before: "Sometimes a body contains the literal HTML-comment opener"
  context_after: "."
  author: Claude
  timestamp: 2026-05-08T10:00:00Z
  resolved: false
  body: |
    If we explain the format, the body needs to render <!\-- like this --\> safely.
- id: 2
  anchor_text: "reads as a transition"
  context_before: "The arrow shape"
  context_after: "in some prose styles."
  author: Maya
  timestamp: 2026-05-08T10:05:00Z
  resolved: false
  body: |
    An arrow like x --\> y appears occasionally in technical writing.
-->
