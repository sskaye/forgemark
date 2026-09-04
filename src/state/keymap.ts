// Every keyboard chord the app answers, in one table.
//
// Shortcuts used to be matched ad hoc in five window listeners, and the
// same chord ended up bound three times: ⌘⇧E opened Clean Export, the
// edit composer for the focused card, and Find with the selection, all
// at once. A listener now asks `commandFor(event)` which command a
// chord names, and the test on this file refuses two commands sharing a
// chord, so a collision cannot appear silently again.
//
// The table names commands, not handlers. Where a command applies is
// still the listener's decision — card commands only while focus is in
// the sidebar, editor commands only for the active pane — and the two
// helpers at the bottom answer the questions every listener asks: is a
// dialog open, and is the user typing into something.
//
// The native menu (src-tauri/src/lib.rs) carries the same chords as
// accelerators for the commands it lists; on macOS the menu handles
// those before the webview sees the keystroke, and they arrive as
// `forgemark:menu` events instead. Both routes lead to the same command.

export type CommandId =
  // App
  | "settings"
  | "print"
  | "clean-export"
  | "toggle-sidebar"
  // File
  | "open"
  | "save"
  | "save-as"
  | "new-tab"
  // Tabs
  | "next-tab"
  | "prev-tab"
  | "tab-1"
  | "tab-2"
  | "tab-3"
  | "tab-4"
  | "tab-5"
  | "tab-6"
  | "tab-7"
  | "tab-8"
  | "tab-9"
  // Editor
  | "find"
  | "find-replace"
  | "find-next"
  | "find-prev"
  | "find-selection"
  | "comment"
  | "suggest"
  // Focused comment card
  | "reply"
  | "toggle-resolved"
  | "edit-comment"
  | "delete-comment"
  | "next-comment"
  | "prev-comment";

export type Chord = {
  // `KeyboardEvent.key`; letters are matched case-insensitively.
  key: string;
  // ⌘ on macOS, Ctrl elsewhere.
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export const KEYMAP: Record<CommandId, Chord[]> = {
  settings: [{ key: ",", mod: true }],
  print: [{ key: "p", mod: true }],
  "clean-export": [{ key: "e", mod: true, shift: true }],
  // ⌘B is bold in the editor; the sidebar takes the alt chord.
  "toggle-sidebar": [{ key: "b", mod: true, alt: true }],

  open: [{ key: "o", mod: true }],
  save: [{ key: "s", mod: true }],
  "save-as": [{ key: "s", mod: true, shift: true }],
  "new-tab": [{ key: "n", mod: true }],

  "next-tab": [{ key: "]", mod: true, shift: true }],
  "prev-tab": [{ key: "[", mod: true, shift: true }],
  "tab-1": [{ key: "1", mod: true }],
  "tab-2": [{ key: "2", mod: true }],
  "tab-3": [{ key: "3", mod: true }],
  "tab-4": [{ key: "4", mod: true }],
  "tab-5": [{ key: "5", mod: true }],
  "tab-6": [{ key: "6", mod: true }],
  "tab-7": [{ key: "7", mod: true }],
  "tab-8": [{ key: "8", mod: true }],
  "tab-9": [{ key: "9", mod: true }],

  find: [{ key: "f", mod: true }],
  "find-replace": [{ key: "f", mod: true, alt: true }],
  "find-next": [{ key: "g", mod: true }],
  "find-prev": [{ key: "g", mod: true, shift: true }],
  "find-selection": [{ key: "e", mod: true }],
  comment: [{ key: "m", mod: true, alt: true }],
  suggest: [{ key: "e", mod: true, alt: true }],

  reply: [{ key: "r", mod: true }],
  "toggle-resolved": [{ key: "Enter", mod: true }],
  // A plain key: only meaningful with a card focused, where typing it
  // cannot mean anything else.
  "edit-comment": [{ key: "e" }],
  "delete-comment": [{ key: "Delete" }, { key: "Backspace" }],
  "next-comment": [{ key: "ArrowDown" }, { key: "j" }],
  "prev-comment": [{ key: "ArrowUp" }, { key: "k" }],
};

export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function chordKey(c: Chord): string {
  const key = c.key.length === 1 ? c.key.toLowerCase() : c.key;
  return `${c.mod ? "M-" : ""}${c.shift ? "S-" : ""}${c.alt ? "A-" : ""}${key}`;
}

const BY_CHORD: Map<string, CommandId> = new Map();
for (const [id, chords] of Object.entries(KEYMAP) as [CommandId, Chord[]][]) {
  for (const c of chords) BY_CHORD.set(chordKey(c), id);
}

// The command a keystroke names, or null.
export function commandFor(e: KeyLike): CommandId | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.metaKey || e.ctrlKey;
  return (
    BY_CHORD.get(`${mod ? "M-" : ""}${e.shiftKey ? "S-" : ""}${e.altKey ? "A-" : ""}${key}`) ?? null
  );
}

// Pairs of commands that share a chord. Empty by construction; the unit
// test asserts it stays that way.
export function chordCollisions(): [CommandId, CommandId][] {
  const seen = new Map<string, CommandId>();
  const out: [CommandId, CommandId][] = [];
  for (const [id, chords] of Object.entries(KEYMAP) as [CommandId, Chord[]][]) {
    for (const c of chords) {
      const k = chordKey(c);
      const prev = seen.get(k);
      if (prev && prev !== id) out.push([prev, id]);
      seen.set(k, id);
    }
  }
  return out;
}

// Whether any dialog is open. Every modal renders `role="dialog"`, and a
// shortcut fired over one acts on something the user can't see.
export function modalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector('[role="dialog"]') != null;
}

// Whether the keystroke is going into a text field, where plain keys
// are text and even ⌘⏎ has a meaning of its own.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "textarea" || tag === "input" || target.isContentEditable === true;
}
