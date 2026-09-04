import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isRelativeRef, resolveResource } from "../services/documentLinks";

// Images written relative to the document (`![](images/x.png)`) load
// from the document's folder. The file keeps the path as written; the
// node's DOM gets an asset URL through a decoration, so nothing in the
// document changes. The folder is given at creation and can be changed
// (a Save As) with `setAssetBase`. Raw HTML blocks read the same folder
// from this extension's storage when they render.

export interface AssetPathsOptions {
  baseDir: string | null;
}

type State = { baseDir: string | null; set: DecorationSet };

const key = new PluginKey<State>("assetPaths");

export function setAssetBase(view: EditorView, baseDir: string | null): void {
  const current = key.getState(view.state);
  if (!current || current.baseDir === baseDir) return;
  view.dispatch(view.state.tr.setMeta(key, baseDir));
}

function decorate(doc: PMNode, baseDir: string | null): DecorationSet {
  if (!baseDir) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "image") return !node.isLeaf;
    const src = String(node.attrs.src ?? "");
    if (isRelativeRef(src)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { src: resolveResource(baseDir, src) }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const AssetPaths = Extension.create<AssetPathsOptions, { baseDir: string | null }>({
  name: "assetPaths",

  addOptions() {
    return { baseDir: null };
  },

  addStorage() {
    return { baseDir: this.options.baseDir };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<State>({
        key,
        state: {
          init: (_config, state) => ({
            baseDir: storage.baseDir,
            set: decorate(state.doc, storage.baseDir),
          }),
          apply: (tr, old) => {
            const meta = tr.getMeta(key) as string | null | undefined;
            if (meta === undefined && !tr.docChanged) return old;
            const baseDir = meta === undefined ? old.baseDir : meta;
            storage.baseDir = baseDir;
            return { baseDir, set: decorate(tr.doc, baseDir) };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.set;
          },
        },
      }),
    ];
  },
});
