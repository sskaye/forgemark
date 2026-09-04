// Keeps the editor and the Markdown source in step one block at a time.
//
// `load(body)` splits the body into blocks (src/format/blocks.ts) and
// returns what the editor should show: one node per block, anchor edges
// as elements, raw HTML as verbatim placeholders. `emit(doc)` is called after
// the editor changed; it finds the run of top-level nodes that differ
// from the last known document by identity (ProseMirror keeps untouched
// nodes as the same objects), serializes just that run, and splices it
// into the blocks' own lines. The result is a body in which only the
// edited blocks were rewritten.
//
// Correspondence is by index: block i is node i. That holds by
// construction for everything markdown-it calls a block (paragraphs,
// headings, lists, quotes, tables, code, rules) and for raw HTML, which
// becomes a placeholder node. If it ever doesn't — a construct that
// parses into two nodes — `emit` notices the count mismatch and falls
// back to serializing the whole document, which is what the editor
// always did; never a corrupt splice.

import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { splitBlocks, spliceBlocks, type BlockMap } from "../format/blocks";
import { bodyWithAnchorElements, coalesceAnchorMarkers } from "../format/markers-display";
import { verbatimTag } from "./VerbatimBlock";

export type Serializer = { serialize(content: Fragment): string };

export type BlockSync = {
  // What the editor should be given for this body.
  load(body: string): string;
  // The new body after the editor's document became `doc`.
  emit(doc: PMNode, serializer: Serializer): string;
  // Record the editor's document after `load` was applied, so the next
  // `emit` has something to diff against.
  settle(doc: PMNode): void;
  // For tests and diagnostics: how the last emit was produced.
  lastMode(): "splice" | "whole" | null;
};

export function createBlockSync(): BlockSync {
  let map: BlockMap = splitBlocks("");
  let lastDoc: PMNode | null = null;
  let mode: "splice" | "whole" | null = null;

  // Link reference definitions live in the gaps between blocks (markdown-it
  // consumes them without a token). They are appended to what the editor
  // parses so `[text][ref]` in an edited block resolves — and comes back
  // as an inline link — instead of being escaped to literal brackets.
  // They produce no node, so the block-to-node correspondence holds.
  const definitions = (m: BlockMap) => {
    const covered = new Set<number>();
    for (const b of m.blocks) for (let i = b.start; i < b.end; i++) covered.add(i);
    return m.lines.filter((line, i) => !covered.has(i) && /^ {0,3}\[[^\]]+\]:\s*\S/.test(line));
  };

  const display = (m: BlockMap) => {
    const shown = m.blocks
      .map((b) => (b.kind === "verbatim" ? verbatimTag(b.text) : bodyWithAnchorElements(b.text)))
      .join("\n\n");
    const defs = definitions(m);
    return defs.length ? `${shown}\n\n${defs.join("\n")}` : shown;
  };

  return {
    load(body) {
      // The body just emitted comes straight back here when the state
      // re-renders the editor. The map already describes it; forgetting
      // the document we diff against would send the next edit down the
      // whole-document road.
      if (map.lines.join("\n") === body && lastDoc) return display(map);
      map = splitBlocks(body);
      lastDoc = null;
      return display(map);
    },
    settle(doc) {
      lastDoc = doc;
    },
    lastMode: () => mode,
    emit(doc, serializer) {
      const blockCount = map.blocks.length;
      const whole = () => {
        mode = "whole";
        const body = coalesceAnchorMarkers(serializer.serialize(doc.content));
        map = splitBlocks(body);
        lastDoc = doc;
        return body;
      };
      // Nodes beyond the block count are new (an empty paragraph the
      // editor keeps at the end, or one the reader started typing in).
      const old = lastDoc;
      if (!old || old.childCount < blockCount) return whole();

      // Longest unchanged prefix and suffix, by node identity.
      const oldReal = blockCount;
      const newCount = doc.childCount;
      let prefix = 0;
      while (prefix < oldReal && prefix < newCount && old.child(prefix) === doc.child(prefix)) {
        prefix++;
      }
      let suffix = 0;
      while (
        suffix < oldReal - prefix &&
        suffix < newCount - prefix &&
        old.child(oldReal - 1 - suffix) === doc.child(newCount - 1 - suffix)
      ) {
        suffix++;
      }
      const oldFrom = prefix;
      const oldTo = oldReal - suffix;
      const changed: PMNode[] = [];
      for (let i = prefix; i < newCount - suffix; i++) changed.push(doc.child(i));

      // Trailing empty paragraph the editor keeps for the caret: not a
      // block, unless it's the only thing that changed and has content.
      const isEmptyPara = (n: PMNode) => n.type.name === "paragraph" && n.content.size === 0;
      while (changed.length > 0 && isEmptyPara(changed[changed.length - 1])) {
        if (oldTo > oldFrom || changed.length > 1) changed.pop();
        else break;
      }
      if (changed.length === 0 && oldTo === oldFrom) {
        mode = "splice";
        lastDoc = doc;
        return map.lines.join("\n");
      }

      const replacement =
        changed.length === 0
          ? ""
          : coalesceAnchorMarkers(
              serializer.serialize(
                doc.content.cut(nodeStart(doc, prefix), nodeStart(doc, prefix + changed.length)),
              ),
            );
      const body = spliceBlocks(map, oldFrom, oldTo, replacement);
      const next = splitBlocks(body);
      // The splice must leave block i as node i, or the next edit would
      // land in the wrong lines. If it doesn't, take the safe road.
      const realNodes = countRealNodes(doc, isEmptyPara);
      if (next.blocks.length !== realNodes) return whole();
      mode = "splice";
      map = next;
      lastDoc = doc;
      return body;
    },
  };
}

function nodeStart(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

function countRealNodes(doc: PMNode, isEmptyPara: (n: PMNode) => boolean): number {
  let n = doc.childCount;
  if (n > 0 && isEmptyPara(doc.child(n - 1))) n--;
  return n;
}
