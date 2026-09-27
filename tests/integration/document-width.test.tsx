// The document width: the title bar's slider and value, and the
// column's edge handles. Layout does not exist here, so the edge test
// gives the column and the pane their sizes by hand.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { DocumentProvider } from "../../src/state/DocumentProvider";
import { AppShell } from "../../src/components/AppShell";
import { parseTyped } from "../../src/components/WidthControl";

// jsdom has neither PointerEvent nor pointer capture. Without the
// constructor, fireEvent falls back to a bare Event and drops `button`
// and `clientX`.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const win = window as unknown as Record<string, unknown>;
const saved = {
  set: proto.setPointerCapture,
  release: proto.releasePointerCapture,
  has: proto.hasPointerCapture,
  PointerEvent: win.PointerEvent,
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("forgemark.firstRunDone", "true");
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.hasPointerCapture = vi.fn(() => true);
  win.PointerEvent = class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: globalThis.MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  };
});

afterEach(() => {
  proto.setPointerCapture = saved.set;
  proto.releasePointerCapture = saved.release;
  proto.hasPointerCapture = saved.has;
  win.PointerEvent = saved.PointerEvent;
});

function renderApp() {
  return render(
    <ThemeProvider initialPreference="light">
      <DocumentProvider>
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>,
  );
}

const root = () => document.documentElement;
const stored = () => window.localStorage.getItem("forgemark.documentWidth");

describe("document width — title bar", () => {
  it("starts full, and carries an old Readable setting over", () => {
    const first = renderApp();
    expect(root().dataset.docWidth).toBe("full");
    expect(screen.getByTestId("fm-width-value")).toHaveTextContent("Full");
    first.unmount();

    window.localStorage.setItem("forgemark.documentWidth", "readable");
    renderApp();
    expect(root().dataset.docWidth).toBe("measure");
    expect(root().style.getPropertyValue("--fm-doc-chars")).toBe("70");
    expect(screen.getByTestId("fm-width-value")).toHaveTextContent("70");
  });

  it("previews while the slider moves and remembers it when let go", () => {
    renderApp();
    const slider = screen.getByTestId("fm-width-slider");
    fireEvent.input(slider, { target: { value: "90" } });
    expect(root().style.getPropertyValue("--fm-doc-chars")).toBe("90");
    expect(screen.getByTestId("fm-width-value")).toHaveTextContent("90");
    expect(stored()).toBeNull();
    fireEvent.change(slider, { target: { value: "90" } });
    expect(stored()).toBe("90");
  });

  it("reads the slider's last stop as Full, and double-click resets", () => {
    window.localStorage.setItem("forgemark.documentWidth", "80");
    renderApp();
    const slider = screen.getByTestId("fm-width-slider");
    fireEvent.input(slider, { target: { value: "161" } });
    fireEvent.change(slider, { target: { value: "161" } });
    expect(stored()).toBe("full");
    expect(root().dataset.docWidth).toBe("full");
    window.localStorage.setItem("forgemark.documentWidth", "80");
    fireEvent.doubleClick(slider);
    expect(stored()).toBe("full");
  });

  it("takes a typed width on Enter and ignores it on Escape", () => {
    renderApp();
    const value = screen.getByTestId("fm-width-value");
    fireEvent.pointerDown(value, { button: 0, clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(value, { clientX: 10, pointerId: 1 });
    const input = screen.getByTestId("fm-width-input");
    fireEvent.change(input, { target: { value: "64" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored()).toBe("64");
    expect(screen.getByTestId("fm-width-value")).toHaveTextContent("64");

    fireEvent.keyDown(screen.getByTestId("fm-width-value"), { key: "Enter" });
    const again = screen.getByTestId("fm-width-input");
    fireEvent.change(again, { target: { value: "120" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(stored()).toBe("64");
  });

  it("scrubs when the value is dragged, and steps with the arrow keys", () => {
    window.localStorage.setItem("forgemark.documentWidth", "70");
    renderApp();
    const value = screen.getByTestId("fm-width-value");
    fireEvent.pointerDown(value, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(value, { clientX: 120, pointerId: 1 });
    expect(root().style.getPropertyValue("--fm-doc-chars")).toBe("80");
    fireEvent.pointerUp(value, { clientX: 120, pointerId: 1 });
    expect(stored()).toBe("80");
    expect(screen.queryByTestId("fm-width-input")).toBeNull();

    fireEvent.keyDown(screen.getByTestId("fm-width-value"), { key: "ArrowLeft" });
    expect(stored()).toBe("79");
    fireEvent.keyDown(screen.getByTestId("fm-width-value"), { key: "ArrowRight", shiftKey: true });
    expect(stored()).toBe("89");
  });

  it("understands what can be typed", () => {
    expect(parseTyped("72")).toBe(72);
    expect(parseTyped(" 12 ")).toBe(40);
    expect(parseTyped("400")).toBe("full");
    expect(parseTyped("Full")).toBe("full");
    expect(parseTyped("f")).toBe("full");
    expect(parseTyped("wide")).toBeNull();
    expect(parseTyped("")).toBeNull();
  });
});

describe("document width — column edges", () => {
  it("dragging an edge in narrows the column about its centre", () => {
    renderApp();
    const right = screen.getByTestId("fm-column-edge-right");
    const column = right.parentElement!;
    const pane = column.closest<HTMLElement>(".fm-editor-pane")!;
    column.getBoundingClientRect = () => ({ width: 800 }) as DOMRect;
    Object.defineProperty(pane, "clientWidth", { value: 1200, configurable: true });

    // 17px type with no measurement: 8.5px a character. Moving the right
    // edge 100px in takes 200px off the text: 600px, about 71 characters.
    fireEvent.pointerDown(right, { button: 0, clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 800, pointerId: 1 });
    expect(root().style.getPropertyValue("--fm-doc-chars")).toBe("71");
    expect(screen.getByTestId("fm-width-value")).toHaveTextContent("71");
    fireEvent.pointerUp(right, { clientX: 800, pointerId: 1 });
    expect(stored()).toBe("71");

    // Out past the pane's edge is Full.
    const left = screen.getByTestId("fm-column-edge-left");
    fireEvent.pointerDown(left, { button: 0, clientX: 300, pointerId: 2 });
    fireEvent.pointerMove(left, { clientX: 0, pointerId: 2 });
    fireEvent.pointerUp(left, { clientX: 0, pointerId: 2 });
    expect(stored()).toBe("full");

    act(() => window.localStorage.setItem("forgemark.documentWidth", "50"));
    fireEvent.doubleClick(left);
    expect(stored()).toBe("full");
  });
});
