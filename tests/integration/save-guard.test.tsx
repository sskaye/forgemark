import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { recoverForgemarkFile, parseForgemarkFile, serializeForgemarkFile } from "../../src/format";
import { addReply } from "../../cli/lib";
import type { Comment } from "../../src/format/types";

// Two guards on the app side of the review-loss fixes:
//
//   1. A file whose comments block could not be read opens as plain
//      Markdown with the block still in the body. Adding a comment and
//      saving used to append a *second* block with colliding ids; now
//      the save is refused with a banner and the file is not touched.
//   2. A file the CLI writes while the app has it open arrives through
//      the external-change path like any other edit, and applying it
//      shows the new reply.

const writeTextFileMock = vi.fn(() => Promise.resolve());
const readTextFileMock = vi.fn(() => Promise.resolve(""));
const statMock = vi.fn(() =>
  Promise.resolve({ mtime: new Date(0), readonly: false, isDirectory: false }),
);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...(args as [])),
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...(args as [])),
  stat: (...args: unknown[]) => statMock(...(args as [])),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
  writeTextFileMock.mockClear();
});

const fp = (hash: string) => ({ hash, mtimeMs: null });

function Probe({
  initial,
  external,
}: {
  initial: { text: string; body: string; comments: Comment[] };
  external?: { text: string; body: string; comments: Comment[] };
}) {
  const { state, dispatch } = useDocument();
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
    dispatch({
      type: "load",
      filePath: "/tmp/guard.md",
      fileName: "guard.md",
      text: initial.text,
      body: initial.body,
      comments: initial.comments,
      readOnly: false,
    });
  }
  return (
    <div>
      <span data-testid="probe-comment-count">{state.comments.length}</span>
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="probe-replies">
        {JSON.stringify(state.comments.map((c) => (c.replies ?? []).map((r) => r.body)))}
      </span>
      <button
        data-testid="probe-add-floating"
        onClick={() =>
          dispatch({
            type: "addComment",
            body: state.body,
            comment: {
              id: 1,
              floating: true,
              author: "Maya",
              timestamp: "2026-09-03T12:00:00Z",
              resolved: false,
              body: "A new note.\n",
            },
          })
        }
      />
      <button
        data-testid="probe-fire-watcher"
        onClick={() =>
          external &&
          dispatch({
            type: "externalChangeDetected",
            text: external.text,
            body: external.body,
            comments: external.comments,
            fingerprint: fp("disk-hash"),
          })
        }
      />
      <button data-testid="probe-apply" onClick={() => dispatch({ type: "applyExternalChange" })} />
    </div>
  );
}

function renderApp(props: React.ComponentProps<typeof Probe>) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <Probe {...props} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

// A file whose block is unreadable (a bare colon in an unquoted body).
const BROKEN =
  "# Doc\n\nProse.\n\n<!-- forgemark-comments\n- id: 1\n  floating: true\n  author: A\n  timestamp: 2026-05-07T14:32:00Z\n  resolved: false\n  body: The report: Purpose\n-->\n";

describe("save guard for an unreadable comments block", () => {
  it("opens as plain markdown with the block left in the body", () => {
    const recovery = recoverForgemarkFile(BROKEN);
    expect(recovery.file.comments).toEqual([]);
    expect(recovery.file.body).toBe(BROKEN);
    expect(recovery.problems[0]).toMatch(/line 11 \(comment id 1\)/);
  });

  it("refuses ⌘S after a comment is added, with a banner, and writes nothing", async () => {
    const recovery = recoverForgemarkFile(BROKEN);
    renderApp({ initial: { text: BROKEN, ...recovery.file } });

    fireEvent.click(screen.getByTestId("probe-add-floating"));
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");

    fireEvent.keyDown(window, { key: "s", metaKey: true });

    const banner = await screen.findByTestId("fm-error-banner");
    expect(banner.textContent).toMatch(/already contains a comments block at line 5/);
    expect(writeTextFileMock).not.toHaveBeenCalled();
    // Still dirty: the user's note is not lost, only unsaved.
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
  });

  it("refuses auto-save the same way", async () => {
    const recovery = recoverForgemarkFile(BROKEN);
    renderApp({ initial: { text: BROKEN, ...recovery.file } });
    fireEvent.click(screen.getByTestId("probe-add-floating"));

    await waitFor(
      () => expect(screen.getByTestId("fm-error-banner").textContent).toMatch(/line 5/),
      { timeout: 3000 },
    );
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });
});

describe("a file written by the CLI while the app has it open", () => {
  const ORIGINAL =
    'x <!-- fmc:1 -->some text<!-- /fmc:1 --> y\n\n<!-- forgemark-comments\n- id: 1\n  anchor_text: "some text"\n  author: Maya\n  timestamp: 2026-05-07T09:00:00Z\n  resolved: false\n  body: |\n    ok\n-->\n';

  it("arrives as an external change and applies with the new reply", async () => {
    const parsed = parseForgemarkFile(ORIGINAL);
    const written = serializeForgemarkFile(
      addReply(parsed, 1, { author: "Claude", body: "Done.", now: "2026-09-03T12:00:00Z" }).file,
    );
    const onDisk = parseForgemarkFile(written, { tolerant: true });

    renderApp({
      initial: { text: ORIGINAL, body: parsed.body, comments: parsed.comments },
      external: { text: written, body: onDisk.body, comments: onDisk.comments },
    });

    fireEvent.click(screen.getByTestId("probe-fire-watcher"));
    expect(await screen.findByTestId("fm-conflict-banner")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("probe-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("probe-replies").textContent).toBe(JSON.stringify([["Done.\n"]])),
    );
    expect(screen.getByTestId("probe-comment-count").textContent).toBe("1");
  });
});
