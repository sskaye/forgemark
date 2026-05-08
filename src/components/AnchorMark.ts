import { Mark, mergeAttributes } from "@tiptap/core";

// Custom inline Mark for Forgemark anchor spans. The pre-processor
// (`bodyWithAnchorSpans`) converts `<!-- fmc:N -->X<!-- /fmc:N -->` into
// `<span data-anchor-id="N">X</span>`; this Mark is what teaches Tiptap
// to ingest those spans without dropping the attribute, and to render
// them back out again with the same attribute attached.
//
// Without this Mark, the default schema would treat the span as unknown
// HTML and either strip it or convert it to plain text.
export const AnchorMark = Mark.create({
  name: "anchor",

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute("data-anchor-id");
          return raw == null ? null : raw;
        },
        renderHTML: (attrs: { anchorId: string | null }) =>
          attrs.anchorId == null ? {} : { "data-anchor-id": String(attrs.anchorId) },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-anchor-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  // Inclusive: typing inside an anchor extends the mark, so user edits
  // don't accidentally split the span. Phase 5's edit story refines this.
  inclusive: true,
});
