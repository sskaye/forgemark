import { fireEvent } from "@testing-library/react";

// Simulate a user typing into the rendered (Tiptap/ProseMirror) editor.
//
// ProseMirror doesn't listen for synthetic `keydown` the way a plain
// <textarea> would — it observes its contenteditable through a
// MutationObserver. So the faithful way to fake typing under jsdom is to
// mutate the DOM and let that observer pick the change up, which is what
// this does.
//
// This matters more than it looks. Until it existed, nothing in the suite
// exercised a real keystroke into the rendered editor, and a bug where
// *every* keystroke in an empty Untitled document was silently discarded
// sat behind 377 passing tests. See tests/integration/untitled-editing.
// `blockIndex` picks which paragraph to type into. Note this replaces the
// block's whole text content, so typing into a paragraph that carries a
// comment anchor will wipe that anchor's markup — target a different
// block when the anchor is meant to survive.
export function typeIntoEditor(container: HTMLElement, text: string, blockIndex = 0): void {
  const pm = container.querySelector(".ProseMirror") as HTMLElement | null;
  if (!pm) throw new Error("typeIntoEditor: rendered editor is not mounted");
  // Falling back to the root covers an empty document that hasn't got a
  // paragraph node yet.
  const target = (pm.querySelectorAll("p")[blockIndex] as HTMLElement | undefined) ?? pm;
  target.textContent = text;
  fireEvent.input(pm);
}

export function editorText(container: HTMLElement): string {
  const pm = container.querySelector(".ProseMirror");
  if (!pm) throw new Error("editorText: rendered editor is not mounted");
  return pm.textContent ?? "";
}
