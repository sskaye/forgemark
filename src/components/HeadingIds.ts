import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { slugger } from "../services/documentLinks";

// Every heading carries the id GitHub would give it, so `[x](#my-heading)`
// and a table of contents have somewhere to go. The id is a decoration,
// not an attribute, so it never reaches the file.

function decorate(doc: PMNode): DecorationSet {
  const slug = slugger();
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return !node.isLeaf;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id: slug(node.textContent) }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const HeadingIds = Extension.create({
  name: "headingIds",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: new PluginKey("headingIds"),
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// Scroll the element with `id` under `root` into view.
export function scrollToFragment(root: Element, id: string): boolean {
  const target = Array.from(root.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === id);
  if (!target) return false;
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  return true;
}
