import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { SESSION_KEY } from "../src/state/session";

// Session restore persists the open documents in localStorage, which
// jsdom shares across tests in a file. Without this, one test's open
// files get restored into the next test's freshly mounted app.
//
// Only the session key is cleared — other suites have their own
// expectations about preferences storage.
beforeEach(() => {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // jsdom without storage; nothing to clear.
  }
});
