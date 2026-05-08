import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider, useDocument } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { serializeForgemarkFile } from "../../src/format";
import type { Comment } from "../../src/format/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  stat: vi.fn(),
  watch: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.author", "Maya");
});

function HarnessProbe({ initial }: { initial: { body: string; comments: Comment[] } }) {
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
      <span data-testid="probe-dirty">{state.dirty ? "dirty" : "clean"}</span>
      <span data-testid="probe-comments-json">{JSON.stringify(state.comments)}</span>
      <span data-testid="probe-serialized">
        {serializeForgemarkFile({ body: state.body, comments: state.comments })}
      </span>
    </div>
  );
}

function renderApp(initial: { body: string; comments: Comment[] }) {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
        <HarnessProbe initial={initial} />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

// A document where the markers have been stripped externally (e.g. an
// AI rewrote the prose). The anchor_text is still recoverable as exact
// substring text.
const ORPHANED_FIXTURE = {
  body: "Across fourteen interviews with new enterprise customers, the strongest predictor of week-two retention was completing a real piece of work.\n",
  comments: [
    {
      id: 1,
      author: "Claude",
      timestamp: "2026-05-07T09:14:00Z",
      resolved: false,
      anchor_text: "fourteen interviews with new enterprise customers",
      context_before: "Across",
      context_after: ", the strongest predictor",
      body: "Worth surfacing the sample composition.\n",
    },
  ] as Comment[],
};

const NO_RECOVERY_FIXTURE = {
  body: "completely unrelated prose, no anchor candidates here\n",
  comments: [
    {
      id: 1,
      author: "Claude",
      timestamp: "2026-05-07T09:14:00Z",
      resolved: false,
      anchor_text: "fourteen interviews with new enterprise customers",
      body: "old comment\n",
    },
  ] as Comment[],
};

describe("Phase 9 — lost-anchor banner + sidebar section", () => {
  it("shows the LOST ANCHOR section + banner when an orphan exists", async () => {
    renderApp(ORPHANED_FIXTURE);
    expect(await screen.findByTestId("fm-lost-banner")).toBeInTheDocument();
    expect(screen.getByTestId("fm-sidebar-section-orphans")).toBeInTheDocument();
    expect(screen.getByTestId("fm-card-orphan-pill-1")).toBeInTheDocument();
  });

  it("hides the banner when there are no orphans", async () => {
    renderApp({
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
      ],
    });
    await screen.findByTestId("fm-card-1");
    expect(screen.queryByTestId("fm-lost-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fm-sidebar-section-orphans")).not.toBeInTheDocument();
  });

  it("shows FLOATING NOTES section when a floating comment exists", async () => {
    renderApp({
      body: "any prose here\n",
      comments: [
        {
          id: 1,
          author: "Maya",
          timestamp: "2026-05-07T09:00:00Z",
          resolved: false,
          floating: true,
          body: "high-level note\n",
        },
      ],
    });
    expect(await screen.findByTestId("fm-sidebar-section-floating")).toBeInTheDocument();
    expect(screen.getByTestId("fm-card-floating-pill-1")).toBeInTheDocument();
  });
});

describe("Phase 9 — Reattach modal: three paths", () => {
  it("Recover button opens the modal with candidates", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    const modal = await screen.findByTestId("fm-reattach-modal");
    expect(modal).toBeInTheDocument();
    expect(screen.getByTestId("fm-reattach-candidates")).toBeInTheDocument();
    expect(screen.getByTestId("fm-reattach-candidate-0")).toBeInTheDocument();
  });

  it("Reattach here re-anchors the comment and removes the orphan flag", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-apply"));
    // Markers re-inserted in body around the matched text.
    await waitFor(() => {
      expect(screen.getByTestId("probe-body").textContent).toContain("<!-- fmc:1 -->");
    });
    expect(screen.getByTestId("probe-body").textContent).toContain("<!-- /fmc:1 -->");
    expect(screen.queryByTestId("fm-lost-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-dirty").textContent).toBe("dirty");
    // The reattached YAML is no longer floating.
    const comments: Comment[] = JSON.parse(
      screen.getByTestId("probe-comments-json").textContent ?? "[]",
    );
    expect(comments[0].floating).toBeUndefined();
    expect(comments[0].anchor_text).toBe("fourteen interviews with new enterprise customers");
  });

  it("Keep as floating note sets floating: true and clears anchor metadata", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-keep-floating"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-reattach-modal")).not.toBeInTheDocument();
    });
    const comments: Comment[] = JSON.parse(
      screen.getByTestId("probe-comments-json").textContent ?? "[]",
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].floating).toBe(true);
    expect(comments[0].anchor_text).toBeUndefined();
    expect(screen.getByTestId("fm-sidebar-section-floating")).toBeInTheDocument();
    expect(screen.queryByTestId("fm-lost-banner")).not.toBeInTheDocument();
  });

  it("Discard removes the comment and clears the modal", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-discard"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-comment-count").textContent).toBe("0");
    });
    expect(screen.queryByTestId("fm-lost-banner")).not.toBeInTheDocument();
  });

  it("modal with no candidates only offers Keep as floating / Discard / Cancel", async () => {
    renderApp(NO_RECOVERY_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    expect(await screen.findByTestId("fm-reattach-no-candidates")).toBeInTheDocument();
    const apply = screen.getByTestId("fm-reattach-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByTestId("fm-reattach-keep-floating")).toBeInTheDocument();
    expect(screen.getByTestId("fm-reattach-discard")).toBeInTheDocument();
  });

  it("modal Cancel leaves the comment unchanged", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-reattach-modal")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("probe-comment-count").textContent).toBe("1");
    expect(screen.getByTestId("fm-lost-banner")).toBeInTheDocument();
  });
});

describe("Phase 9 — Reattach via card Recover…", () => {
  it("clicking the orphan card's Reattach… opens the modal for that card", async () => {
    renderApp(ORPHANED_FIXTURE);
    const card = await screen.findByTestId("fm-card-1");
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("fm-card-reattach-1"));
    expect(await screen.findByTestId("fm-reattach-modal")).toBeInTheDocument();
  });
});

describe("Phase 9 — round-trip after each recovery path", () => {
  it("after Reattach the serialized output parses cleanly with markers", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-apply"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-body").textContent).toContain("<!-- fmc:1 -->");
    });
    const text = screen.getByTestId("probe-serialized").textContent ?? "";
    const { parseForgemarkFile } = await import("../../src/format");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].floating).toBeUndefined();
  });

  it("after Keep as floating the serialized output round-trips with floating: true", async () => {
    renderApp(ORPHANED_FIXTURE);
    fireEvent.click(await screen.findByTestId("fm-lost-banner-recover"));
    fireEvent.click(await screen.findByTestId("fm-reattach-keep-floating"));
    await waitFor(() => {
      expect(screen.queryByTestId("fm-reattach-modal")).not.toBeInTheDocument();
    });
    const text = screen.getByTestId("probe-serialized").textContent ?? "";
    const { parseForgemarkFile } = await import("../../src/format");
    const parsed = parseForgemarkFile(text);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].floating).toBe(true);
    expect(parsed.comments[0].anchor_text).toBeUndefined();
    // Body should NOT contain markers.
    expect(parsed.body).not.toContain("<!-- fmc:1 -->");
  });
});
