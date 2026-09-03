import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { parseForgemarkFile } from "../../src/format";

// Adding a comment used to re-serialize the whole document through the
// editor: front matter became a heading, hard wraps were unwrapped,
// reference links inlined, HTML comments deleted. A comment now splices
// two markers into the untouched source, so a review-only session leaves
// every other byte exactly as the author wrote it.

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(() => Promise.resolve()),
  lstat: vi.fn(() => Promise.resolve({ isSymlink: false })),
  remove: vi.fn(() => Promise.resolve()),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

// Everything the editor normalizes, in one body.
const BODY = [
  "---",
  "title: Field notes",
  "tags: [review, markdown]",
  "---",
  "",
  "# Field notes",
  "",
  "The programmed basal is too high over",
  "the evening and the small hours, see [the report][r].",
  "",
  "<!-- editors: keep the wrap -->",
  "",
  "* star bullet",
  "* another with `code` and **bold `code`**",
  "",
  "The evening and the small hours appear twice: over",
  "the evening and the small hours again.",
  "",
  "[r]: https://example.com/report",
  "",
].join("\n");

function Probe({ onState }: { onState: (body: string, comments: unknown[]) => void }) {
  const { state, dispatch } = useDocument();
  const loaded = useRef(false);
  if (!loaded.current) {
    loaded.current = true;
    dispatch({
      type: "load",
      filePath: "/tmp/notes.md",
      fileName: "notes.md",
      text: BODY,
      body: BODY,
      comments: [],
      readOnly: false,
    });
  }
  onState(state.body, state.comments);
  return (
    <div>
      <button
        data-testid="probe-open-composer"
        onClick={() =>
          dispatch({
            type: "openComposer",
            composer: {
              mode: "new",
              from: 1,
              to: 5,
              selectionText: "the evening and the small hours",
              contextBefore: "The programmed basal is too high over ",
              contextAfter: ", see the report.",
              x: 10,
              y: 20,
            },
          })
        }
      />
      <button
        data-testid="probe-open-composer-second"
        onClick={() =>
          dispatch({
            type: "openComposer",
            composer: {
              mode: "new",
              from: 1,
              to: 5,
              selectionText: "the evening and the small hours",
              contextBefore: "appear twice: over ",
              contextAfter: " again.",
              x: 10,
              y: 20,
            },
          })
        }
      />
      <button
        data-testid="probe-open-composer-bold"
        onClick={() =>
          dispatch({
            type: "openComposer",
            composer: {
              mode: "new",
              from: 1,
              to: 5,
              selectionText: "bold code",
              contextBefore: "another with code and ",
              contextAfter: "",
              x: 10,
              y: 20,
            },
          })
        }
      />
    </div>
  );
}

let latestBody = "";
let latestComments: unknown[] = [];

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <Probe
          onState={(b, c) => {
            latestBody = b;
            latestComments = c;
          }}
        />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

async function submit(text: string) {
  const ta = (await screen.findByTestId("fm-composer-textarea")) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
  latestBody = "";
  latestComments = [];
});

describe("adding a comment leaves the rest of the file untouched", () => {
  it("splices the markers around a hard-wrapped passage and nothing else changes", async () => {
    renderApp();
    await waitFor(() => expect(latestBody).toBe(BODY));

    fireEvent.click(screen.getByTestId("probe-open-composer"));
    await submit("Too strong.");

    await waitFor(() => expect(latestComments).toHaveLength(1));
    const expected = BODY.replace(
      "too high over\nthe evening and the small hours, see",
      "too high over\n<!-- fmc:1 -->the evening and the small hours<!-- /fmc:1 -->, see",
    );
    expect(latestBody).toBe(expected);
    const parsed = parseForgemarkFile(latestBody + "\n");
    expect(parsed.body.startsWith("---\ntitle: Field notes")).toBe(true);
    expect((latestComments[0] as { anchor_text: string }).anchor_text).toBe(
      "the evening and the small hours",
    );
  });

  it("uses the selection's surroundings to pick the right occurrence", async () => {
    renderApp();
    await waitFor(() => expect(latestBody).toBe(BODY));

    fireEvent.click(screen.getByTestId("probe-open-composer-second"));
    await submit("Second one.");

    await waitFor(() => expect(latestComments).toHaveLength(1));
    expect(latestBody).toBe(
      BODY.replace(
        "twice: over\nthe evening and the small hours again.",
        "twice: over\n<!-- fmc:1 -->the evening and the small hours<!-- /fmc:1 --> again.",
      ),
    );
  });

  it("wraps formatting the reader selected through, and records the rendered text", async () => {
    renderApp();
    await waitFor(() => expect(latestBody).toBe(BODY));

    fireEvent.click(screen.getByTestId("probe-open-composer-bold"));
    await submit("Why bold?");

    await waitFor(() => expect(latestComments).toHaveLength(1));
    expect(latestBody).toBe(
      BODY.replace("and **bold `code`**", "and <!-- fmc:1 -->**bold `code`**<!-- /fmc:1 -->"),
    );
    expect((latestComments[0] as { anchor_text: string }).anchor_text).toBe("bold code");
  });

  it("shows the new anchor in the editor without rewriting the document", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(latestBody).toBe(BODY));
    fireEvent.click(screen.getByTestId("probe-open-composer"));
    await submit("Too strong.");
    await waitFor(() =>
      expect(container.querySelector('[data-anchor-id="1"]')).toBeInTheDocument(),
    );
    // Still the author's file: front matter intact, wrap intact.
    expect(latestBody.startsWith("---\ntitle: Field notes\n")).toBe(true);
    expect(latestBody).toContain("too high over\n<!-- fmc:1 -->");
  });
});
