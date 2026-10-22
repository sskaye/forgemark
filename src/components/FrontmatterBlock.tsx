import { useEffect, useMemo, useRef } from "react";
import type { Comment } from "../format/types";
import {
  findFrontmatterPassage,
  frontmatterPlacementAt,
  frontmatterText,
  isFrontmatterComment,
} from "../format/frontmatterAnchor";
import type { HtmlCapturedSelection } from "./HtmlView";
import "./FrontmatterBlock.css";

type Props = {
  body: string;
  comments: Comment[];
  focusedCommentId: number | null;
  hoveredCommentId: number | null;
  onAnchorClick: (id: number) => void;
  onAnchorHover: (id: number | null) => void;
  // A selection inside the block, for the Comment toolbar; null when it
  // leaves.
  onSelectionChange?: (capture: HtmlCapturedSelection | null) => void;
};

// A Markdown file's front matter, shown read-only above the document as
// its raw YAML. The editor never sees it (`format/frontmatter.ts`); this
// is where a reader reads it and comments on it. Those comments carry no
// markers (`format/frontmatterAnchor.ts`): each is highlighted where its
// quoted passage is.
export function FrontmatterBlock({
  body,
  comments,
  focusedCommentId,
  hoveredCommentId,
  onAnchorClick,
  onAnchorHover,
  onSelectionChange,
}: Props) {
  const fm = useMemo(() => frontmatterText(body), [body]);
  const preRef = useRef<React.ElementRef<"pre"> | null>(null);

  // The commented passages, in order, without overlaps.
  const anchors = useMemo(() => {
    if (!fm) return [];
    const out: { id: number; start: number; end: number; resolved: boolean }[] = [];
    for (const c of comments) {
      if (!isFrontmatterComment(c)) continue;
      const at = findFrontmatterPassage(body, c);
      if (at)
        out.push({
          id: c.id,
          start: at.start - fm.offset,
          end: at.end - fm.offset,
          resolved: c.resolved,
        });
    }
    out.sort((a, b) => a.start - b.start);
    return out.filter((a, i) => i === 0 || a.start >= out[i - 1].end);
  }, [body, comments, fm]);

  // Report a selection inside the block, in source offsets.
  const reportRef = useRef(onSelectionChange);
  reportRef.current = onSelectionChange;
  const reportedRef = useRef(false);
  useEffect(() => {
    const onChange = () => {
      const pre = preRef.current;
      const report = reportRef.current;
      if (!pre || !report || !fm) return;
      const sel = document.getSelection();
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      const inside =
        range &&
        !range.collapsed &&
        pre.contains(range.startContainer) &&
        pre.contains(range.endContainer);
      if (!inside) {
        if (reportedRef.current) report(null);
        reportedRef.current = false;
        return;
      }
      const start = fm.offset + offsetIn(pre, range.startContainer, range.startOffset);
      const end = fm.offset + offsetIn(pre, range.endContainer, range.endOffset);
      const p = frontmatterPlacementAt(body, start, end);
      if (!p) return;
      const overlapping = anchors.find(
        (a) => a.start < end - fm.offset && a.end > start - fm.offset,
      );
      const rects = range.getClientRects();
      const first = rects[0] ?? range.getBoundingClientRect();
      const last = rects[rects.length - 1] ?? first;
      reportedRef.current = true;
      report({
        from: start,
        to: end,
        text: p.anchor_text,
        contextBefore: p.context_before,
        contextAfter: p.context_after,
        kind: "inline",
        frontmatter: true,
        overlappingAnchorId: overlapping ? overlapping.id : null,
        rect: { left: last.right, top: first.top, bottom: last.bottom },
        token: "",
      });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [body, fm, anchors]);

  if (!fm) return null;

  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const a of anchors) {
    if (a.start > at) parts.push(fm.text.slice(at, a.start));
    const cls = [
      "fm-frontmatter-anchor",
      a.id === focusedCommentId ? "is-focused" : "",
      a.id === hoveredCommentId ? "is-hovered" : "",
      a.resolved ? "is-resolved" : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(
      <span
        key={a.id}
        className={cls}
        data-anchor-id={a.id}
        onClick={() => onAnchorClick(a.id)}
        onMouseEnter={() => onAnchorHover(a.id)}
        onMouseLeave={() => onAnchorHover(null)}
      >
        {fm.text.slice(a.start, a.end)}
      </span>,
    );
    at = a.end;
  }
  parts.push(fm.text.slice(at));

  return (
    <section className="fm-frontmatter" aria-label="Front matter" data-testid="fm-frontmatter">
      <div className="fm-frontmatter-label">Front matter</div>
      <pre className="fm-frontmatter-yaml" ref={preRef}>
        {parts}
      </pre>
    </section>
  );
}

// The character offset of a DOM position within an element's text.
function offsetIn(root: Node, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return range.toString().length;
}
