// Leaving the app, for good or to restart into an update.
//
// Both go through the same unsaved-work walk (`DocumentBindings`): every
// open document with unsaved work is saved or asked about, tab by tab,
// each tab's bindings handing the walk to the next by re-sending this
// event. What happens when nothing is left unsaved is the only
// difference: an exit tells Rust it may quit (`approve_exit`); a restart
// runs the finisher the update service registered, which installs the
// downloaded update and relaunches.

export const QUIT_EVENT = "forgemark:close-requested";

export type QuitThen = "exit" | "restart";

// Start the walk. Rust's close and ⌘Q arrive as a plain event, which
// means "exit".
export function requestQuit(then: QuitThen = "exit"): void {
  window.dispatchEvent(new CustomEvent(QUIT_EVENT, { detail: { then } }));
}

export function quitThenOf(event: Event): QuitThen {
  return (event as CustomEvent<{ then?: QuitThen } | null>).detail?.then === "restart"
    ? "restart"
    : "exit";
}

let restartFinisher: (() => Promise<void>) | null = null;

// The update service registers what a restart means once the walk is
// clear: install, then relaunch.
export function setRestartFinisher(finish: (() => Promise<void>) | null): void {
  restartFinisher = finish;
}

export async function finishRestart(): Promise<void> {
  if (!restartFinisher) throw new Error("There is no update ready to install.");
  await restartFinisher();
}
