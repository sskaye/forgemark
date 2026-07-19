// REPRODUCTION harness for the "marker corruption hides all comments" bug
// report. These tests drive the REAL comment-creation path: a headless
// Tiptap editor built with the exact same extension set as RenderedView,
// plus a faithful copy of RenderedView.applyAnchor (setMark("anchor") ->
// getMarkdown() -> bodyFromAnchorSpans). The point is to confirm the root
// cause empirically, NOT to assert desired behaviour — several of these
// assertions document the BUG (they should be inverted once fixed).

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { AnchorMark } from "../../../src/components/AnchorMark";
import { bodyFromAnchorSpans, bodyWithAnchorSpans } from "../../../src/format/markers-display";
import {
  parseForgemarkFile,
  ForgemarkParseError,
  recoverForgemarkFile,
} from "../../../src/format/parser";
import { serializeForgemarkFile } from "../../../src/format/serializer";
import { getAnchorStatus } from "../../../src/format/reattach";
import type { Comment } from "../../../src/format/types";

// Mirror RenderedView's editor configuration exactly (minus the search /
// view-sync plugins, which are irrelevant to marker serialization).
function makeEditor(markdownBody: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      AnchorMark,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: bodyWithAnchorSpans(markdownBody),
  });
}

// Faithful copy of RenderedView.applyAnchor (RenderedView.tsx:310-327).
function applyAnchor(editor: Editor, from: number, to: number, id: number): string {
  editor
    .chain()
    .setTextSelection({ from, to })
    .setMark("anchor", { anchorId: String(id) })
    .run();
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  const md = storage.markdown?.getMarkdown?.() ?? "";
  return bodyFromAnchorSpans(md);
}

// Count distinct `<!-- fmc:N -->` open markers for a given id in a body.
function countOpenMarkers(body: string, id: number): number {
  const re = new RegExp(`<!--\\s*fmc:${id}\\s*-->`, "g");
  return (body.match(re) ?? []).length;
}

// Build the captured-selection anchor_text the way RenderedView does
// (textBetween over the rendered doc).
function textBetween(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, " ", " ");
}

// Select the entire inline content of the first (single) paragraph.
function wholeParagraphRange(editor: Editor): { from: number; to: number } {
  return { from: 1, to: editor.state.doc.content.size - 1 };
}

function makeRecord(id: number, anchorText: string): Comment {
  return {
    id,
    anchor_text: anchorText,
    context_before: "",
    context_after: "",
    author: "Tester",
    timestamp: "2026-06-21T00:00:00Z",
    resolved: false,
    body: "note",
  };
}

describe("BUG 2 (report): marker splatter across inline markdown", () => {
  it("emits exactly ONE fmc pair for a comment spanning emphasis + link (FIXED)", () => {
    const body =
      "Fabrication is persistent: *Scientific Reports* found ~55% of " +
      "[citations](https://example.com/x) fabricated in one study.";
    const editor = makeEditor(body);
    const { from, to } = wholeParagraphRange(editor);
    const anchorText = textBetween(editor, from, to);
    const newBody = applyAnchor(editor, from, to, 1);
    editor.destroy();

    // FIXED: coalesceAnchorMarkers (inside bodyFromAnchorSpans) collapses
    // the splattered run to a single pair spanning the whole selection.
    expect(countOpenMarkers(newBody, 1)).toBe(1);
    expect((newBody.match(/<!--\s*\/fmc:1\s*-->/g) ?? []).length).toBe(1);

    // And the body now parses cleanly — comments no longer vanish.
    const file = serializeForgemarkFile({ body: newBody, comments: [makeRecord(1, anchorText)] });
    expect(() => parseForgemarkFile(file)).not.toThrow();
  });

  it("a plain-text selection (no inline formatting) still produces exactly one pair", () => {
    // Control: confirms the splatter is specifically caused by inline
    // formatting, not by applyAnchor in general.
    const body = "An organized indexed source repository of prose.";
    const editor = makeEditor(body);
    const { from, to } = wholeParagraphRange(editor);
    const anchorText = textBetween(editor, from, to);
    const newBody = applyAnchor(editor, from, to, 1);
    editor.destroy();

    expect(countOpenMarkers(newBody, 1)).toBe(1);
    const file = serializeForgemarkFile({ body: newBody, comments: [makeRecord(1, anchorText)] });
    expect(() => parseForgemarkFile(file)).not.toThrow();
  });
});

describe("BUG 1 (report): overlapping / nested anchor creation corrupts markers", () => {
  it("a second comment overlapping the first corrupts the marker layout", () => {
    const body = "Outputs of modules 1, 2, 4, 5, 6, and 7 are combined.";
    const editor = makeEditor(body);

    // Comment 11 over the whole sentence.
    const whole = wholeParagraphRange(editor);
    const anchor11 = textBetween(editor, whole.from, whole.to);
    let working = applyAnchor(editor, whole.from, whole.to, 11);
    expect(countOpenMarkers(working, 11)).toBe(1);

    // Re-open an editor on the body that now contains comment 11's span,
    // and add comment 20 on an inner word ("and"), as the UI would.
    const editor2 = makeEditor(working);
    const fullText = editor2.state.doc.textBetween(1, editor2.state.doc.content.size - 1, " ", " ");
    const andIdx = fullText.indexOf(" and ") + 1; // skip leading space
    const innerFrom = 1 + andIdx;
    const innerTo = innerFrom + "and".length;
    const anchor20 = textBetween(editor2, innerFrom, innerTo);
    working = applyAnchor(editor2, innerFrom, innerTo, 20);
    editor.destroy();
    editor2.destroy();

    const file = serializeForgemarkFile({
      body: working,
      comments: [makeRecord(11, anchor11), makeRecord(20, anchor20)],
    });

    // ROOT CAUSE: nesting splits comment 11 into two pairs (or otherwise
    // breaks the 1:1 invariant) -> parser rejects -> every comment vanishes.
    expect(() => parseForgemarkFile(file)).toThrow(ForgemarkParseError);
  });

  it("two comments on the identical span orphan the first record", () => {
    const body = "An organized indexed source repository of prose.";
    const editor = makeEditor(body);
    const { from, to } = wholeParagraphRange(editor);
    const anchor3 = textBetween(editor, from, to);
    let working = applyAnchor(editor, from, to, 3);

    const editor2 = makeEditor(working);
    const range2 = wholeParagraphRange(editor2);
    const anchor17 = textBetween(editor2, range2.from, range2.to);
    working = applyAnchor(editor2, range2.from, range2.to, 17);
    editor.destroy();
    editor2.destroy();

    const file = serializeForgemarkFile({
      body: working,
      comments: [makeRecord(3, anchor3), makeRecord(17, anchor17)],
    });
    // One id's markers overwrite the other's -> a record with no pair.
    expect(() => parseForgemarkFile(file)).toThrow(ForgemarkParseError);
  });
});

describe("shared failure mode: fail-soft instead of blanking ALL comments", () => {
  it("recovers the valid comment when another is corrupt (was: total loss)", () => {
    // Hand-built corrupt body: comment 1 has two non-adjacent pairs (an
    // overlap-style split that coalesce can't merge), comment 2 is fine.
    const body =
      "<!-- fmc:1 -->alpha<!-- /fmc:1 --> mid <!-- fmc:2 -->gamma<!-- /fmc:2 --> tail " +
      "<!-- fmc:1 -->beta<!-- /fmc:1 --> end.";
    const file = serializeForgemarkFile({
      body,
      comments: [makeRecord(1, "alpha"), makeRecord(2, "gamma")],
    });
    // Strict parse still rejects (the round-trip guarantee is unchanged)…
    expect(() => parseForgemarkFile(file)).toThrow(/Duplicate marker pair for id 1/);

    // …but fail-soft recovery salvages the valid comment instead of
    // blanking everything: both records survive, comment 2 stays attached,
    // comment 1 is detached for reattachment.
    const { file: recovered } = recoverForgemarkFile(file);
    expect(recovered.comments.map((c) => c.id).sort()).toEqual([1, 2]);
    const c2 = recovered.comments.find((c) => c.id === 2)!;
    expect(getAnchorStatus(recovered.body, c2).kind).toBe("attached");
  });
});
