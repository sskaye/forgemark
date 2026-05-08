import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import type { Comment } from "../../src/format/types";

const writeTextFileMock = vi.fn(() => Promise.resolve());
const readTextFileMock = vi.fn(() => Promise.resolve(""));
const statMock = vi.fn(() =>
  Promise.resolve({ mtime: new Date(0), readonly: false, isDirectory: false }),
);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...(args as [])),
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...(args as [])),
  stat: (...args: unknown[]) => statMock(...(args as [])),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
  writeTextFileMock.mockClear();
  readTextFileMock.mockClear();
  statMock.mockClear();
});

// Build a fingerprint for the harness — production uses
// services/conflict.fingerprint() but we don't need real hashes here.
const fp = (hash: string, mtimeMs: number | null = null) => ({ hash, mtimeMs });

function HarnessProbe({
  initial,
  externalChange,
}: {
  initial: { body: string; comments: Comment[] };
  externalChange?: {
    text: string;
    body: string;
    comments: Comment[];
    parseError?: string;
  };
}) {
  const { state, dispatch } = useDocument();
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
    dispatch({
      type: "load",
      filePath: "/tmp/x.md",
      fileName: "x.md",
      text: initial.body,
      body: initial.body,
      comments: initial.comments,
      readOnly: false,
    });
  }
  return (
    <div>
      <span data-testid="probe-body">{state.body}</span>
      <span data-testid="probe-comment-count">{state.comments.length}</span>
      <span data-testid="probe-comments-json">{JSON.stringify(state.comments)}</span>
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="probe-original-text">{state.originalText}</span>
      <span data-testid="probe-external">{state.externalChange ? "yes" : "no"}</span>
      <span data-testid="probe-pending-save">{state.pendingSave ? "yes" : "no"}</span>
      <button
        data-testid="probe-fire-watcher"
        onClick={() =>
          externalChange &&
          dispatch({
            type: "externalChangeDetected",
            text: externalChange.text,
            body: externalChange.body,
            comments: externalChange.comments,
            fingerprint: fp("disk-hash"),
            parseError: externalChange.parseError,
          })
        }
      />
      <button
        data-testid="probe-edit-body"
        onClick={() => dispatch({ type: "edit", body: state.body + " (edited)" })}
      />
      <button
        data-testid="probe-touch-watcher"
        onClick={() =>
          // Simulate the watcher firing for a touch-save that
          // ultimately matches our baseline. The watcher service
          // itself decides whether to fire onChange — to test the
          // *application*-level pipeline we just don't dispatch
          // externalChangeDetected at all. So this button is a no-op
          // by design (the absence of a dispatch is the test).
          undefined
        }
      />
    </div>
  );
}

function renderApp(props: React.ComponentProps<typeof HarnessProbe>) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <HarnessProbe {...props} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const SIMPLE = {
  body: "x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n",
  comments: [
    {
      id: 1,
      author: "Maya",
      timestamp: "2026-05-07T09:00:00Z",
      resolved: false,
      anchor_text: "some text",
      body: "ok\n",
    },
  ] as Comment[],
};

describe("Phase 10 — file-conflict banner (clean state)", () => {
  it("appears when externalChangeDetected fires while clean", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: {
        text: "different bytes",
        body: "different body",
        comments: [],
      },
    });
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    expect(await screen.findByTestId("fm-conflict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("fm-conflict-banner-keep")).toBeInTheDocument();
    expect(screen.getByTestId("fm-conflict-banner-reload")).toBeInTheDocument();
  });

  it("Keep your version drops the externalChange and hides the banner", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-conflict-banner-keep"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-conflict-banner")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("probe-external").textContent).toBe("no");
  });

  it("Reload from disk fully replaces state with the external content", async () => {
    const newComments: Comment[] = [
      {
        id: 1,
        author: "Maya",
        timestamp: "2026-05-07T09:00:00Z",
        resolved: true,
        anchor_text: "some text",
        body: "now resolved\n",
      },
      {
        id: 2,
        author: "Claude",
        timestamp: "2026-05-08T10:00:00Z",
        resolved: false,
        anchor_text: "some text",
        body: "added comment\n",
      },
    ];
    renderApp({
      initial: SIMPLE,
      externalChange: {
        text: "x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n",
        body: "x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n",
        comments: newComments,
      },
    });
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-conflict-banner-reload"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-comment-count").textContent).toBe("2");
    });
    const comments: Comment[] = JSON.parse(
      screen.getByTestId("probe-comments-json").textContent ?? "[]",
    );
    expect(comments[0].resolved).toBe(true);
    expect(comments[1].id).toBe(2);
    expect(screen.getByTestId("probe-dirty").textContent).toBe("clean");
    expect(screen.getByTestId("probe-external").textContent).toBe("no");
  });
});

describe("Phase 10 — edit-during-open modal (dirty state)", () => {
  it("appears when externalChangeDetected fires while dirty", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    expect(await screen.findByTestId("fm-edit-during-modal")).toBeInTheDocument();
    expect(screen.getByTestId("fm-edit-during-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("fm-edit-during-keep")).toBeInTheDocument();
    expect(screen.getByTestId("fm-edit-during-reload")).toBeInTheDocument();
  });

  it("summary line includes 'unsaved edits' when body is dirty", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    const summary = await screen.findByTestId("fm-edit-during-summary");
    expect(summary.textContent ?? "").toMatch(/unsaved edits/i);
  });

  it("Cancel keeps the externalChange pending; banner replaces the modal", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-edit-during-modal")).not.toBeInTheDocument();
    });
    // Banner is now visible (even though dirty) and the user can keep editing.
    expect(screen.getByTestId("fm-conflict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
    expect(screen.getByTestId("probe-external").textContent).toBe("yes");
  });

  it("Keep your version dismisses the modal AND clears externalChange", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-keep"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-edit-during-modal")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("fm-conflict-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
    expect(screen.getByTestId("probe-external").textContent).toBe("no");
  });

  it("Reload from disk replaces state and clears dirty", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: {
        text: "x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n",
        body: "x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n",
        comments: SIMPLE.comments,
      },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-reload"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-dirty").textContent).toBe("clean");
    });
    expect(screen.getByTestId("probe-external").textContent).toBe("no");
  });
});

describe("Phase 10 — save-conflict modal (⌘S during conflict)", () => {
  it("⌘S during a conflict opens the save-conflict modal", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff body", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    // Dismiss the edit-during-open modal so we can press ⌘S cleanly.
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    expect(await screen.findByTestId("fm-save-conflict-modal")).toBeInTheDocument();
    expect(screen.getByTestId("fm-save-conflict-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("fm-save-conflict-overwrite")).toBeInTheDocument();
  });

  it("save-conflict modal shows the two diff signals", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: {
        text: "different",
        body: "different body",
        // Disk version drops comment 1 and adds comment 2.
        comments: [
          {
            id: 2,
            author: "Claude",
            timestamp: "2026-05-08T10:00:00Z",
            resolved: false,
            anchor_text: "x",
            body: "added on disk\n",
          },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    const signals = await screen.findByTestId("fm-save-conflict-signals");
    expect(signals.textContent).toMatch(/Comments:/);
    // 1 added on disk (id 2), 1 removed on disk (id 1)
    expect(signals.textContent).toMatch(/1 added on disk/);
    expect(signals.textContent).toMatch(/1 removed on disk/);
    expect(signals.textContent).toMatch(/Body bytes:/);
    expect(signals.textContent).toMatch(/changed/);
  });

  it("'Unknown changes' fallback when disk parse failed", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: {
        text: "garbage",
        body: "garbage",
        comments: [],
        parseError: "not a forgemark file",
      },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    const signals = await screen.findByTestId("fm-save-conflict-signals");
    expect(signals.textContent).toMatch(/Unknown changes/i);
  });

  it("Cancel keeps file dirty + banner visible; subsequent ⌘S re-opens", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff body", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    fireEvent.click(await screen.findByTestId("fm-save-conflict-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-save-conflict-modal")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("fm-conflict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
    expect(screen.getByTestId("probe-external").textContent).toBe("yes");
    // Press ⌘S again — modal returns.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    expect(await screen.findByTestId("fm-save-conflict-modal")).toBeInTheDocument();
  });

  it("Overwrite drops externalChange and writes via pendingSave", async () => {
    renderApp({
      initial: SIMPLE,
      externalChange: { text: "diff", body: "diff body", comments: [] },
    });
    fireEvent.click(screen.getByTestId("probe-edit-body"));
    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    fireEvent.click(await screen.findByTestId("fm-edit-during-cancel"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    });
    fireEvent.click(await screen.findByTestId("fm-save-conflict-overwrite"));
    await waitFor(() => {
      expect(writeTextFileMock).toHaveBeenCalled();
    });
    // After save, externalChange is cleared, dirty is false, no modal.
    await waitFor(() => {
      expect(screen.getByTestId("probe-dirty").textContent).toBe("clean");
    });
    expect(screen.queryByTestId("fm-save-conflict-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-external").textContent).toBe("no");
  });
});

describe("Phase 10 — false-positive avoidance", () => {
  it("if the watcher never dispatches externalChangeDetected, no surface appears", () => {
    // A touch-save (mtime change but content unchanged) is filtered
    // out by services/conflict.compareFingerprints — fileWatcher only
    // fires onChange when the hash differs. The unit-level test for
    // that filter lives in tests/unit/conflict.test.ts; here we just
    // assert the application UI stays clean when nothing was
    // dispatched.
    renderApp({ initial: SIMPLE });
    expect(screen.queryByTestId("fm-conflict-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fm-edit-during-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fm-save-conflict-modal")).not.toBeInTheDocument();
  });
});
