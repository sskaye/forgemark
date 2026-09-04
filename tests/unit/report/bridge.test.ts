import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installBridge } from "../../../src/report/bridge";
import type { BridgeToHost, HostToBridge } from "../../../src/report/protocol";
import { anchorStylesheet } from "../../../src/report/decorate";

// The bridge runs inside a report and talks to the app only through
// its channel. Here it is installed on a jsdom frame with the channel
// replaced by arrays.

const REPORT = `<!doctype html><html><head><title>R</title></head><body>
<p>Minimising over the rest is <b><!-- fmc:1 -->variable projection<!-- /fmc:1 --></b>.</p>
<!-- fmc:2 --><figure id="fig-1"><figcaption>Figure 1. Control holds</figcaption><svg viewBox="0 0 10 10"></svg></figure><!-- /fmc:2 -->
<!-- fmc:3 --><section id="tiles"><div class="tile">Time in range <b>72%</b></div></section><!-- /fmc:3 -->
<p>Trailing prose with <a href="https://x.y/p">a link</a> and <a href="#fig-1">a fragment</a>.</p>
<table id="t1"><tr><th>Head</th></tr><tr><td>42</td></tr></table>
<section id="tiles2"><div class="tile">Deep sleep <b>1h 05m</b></div></section>
</body></html>`;

const THEME = {
  name: "light",
  stylesheet: anchorStylesheet({
    anchorBg: "#ff0",
    anchorBgHover: "#fe0",
    anchorBgFocus: "#fd0",
    anchorBgResolved: "#eee",
    anchorUnderline: "#a80",
    accent: "#08f",
    surface: "#fff",
    text: "#000",
    border: "#ccc",
  }),
};

let frame: HTMLIFrameElement;
let doc: Document;
let sent: BridgeToHost[];
let listeners: Set<(m: HostToBridge) => void>;
let uninstall: () => void;

const tell = (m: HostToBridge) => {
  for (const l of Array.from(listeners)) l(m);
};
const init = (
  comments = [
    { id: 1, kind: "inline" as const },
    { id: 2, kind: "element" as const },
    { id: 3, kind: "passage" as const, text: "range 72%" },
  ],
) =>
  tell({
    type: "init",
    theme: THEME,
    state: { focused: 1, hovered: null, resolved: [2] },
    comments,
  });

function select(phrase: string) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const at = node.data.indexOf(phrase);
    if (at < 0) continue;
    const range = doc.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + phrase.length);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  throw new Error(`not found: ${phrase}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  frame = document.createElement("iframe");
  document.body.appendChild(frame);
  doc = frame.contentDocument!;
  doc.open();
  doc.write(REPORT);
  doc.close();
  sent = [];
  listeners = new Set();
  uninstall = installBridge(frame.contentWindow as Window, {
    send: (m) => sent.push(m),
    onMessage: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  });
});

afterEach(() => {
  uninstall();
  frame.remove();
  vi.useRealTimers();
});

describe("installing", () => {
  it("announces itself and, once told what to show, decorates and styles", () => {
    expect(sent[0]).toEqual({ type: "ready" });
    init();
    expect(doc.querySelector("[data-anchor-id='1']")?.textContent).toBe("variable projection");
    expect(doc.querySelector("figure[data-anchor-id='2']")).not.toBeNull();
    expect(doc.querySelector("[data-anchor-id='1']")?.classList.contains("is-focused")).toBe(true);
    expect(doc.querySelector("[data-anchor-id='2']")?.classList.contains("is-resolved")).toBe(true);
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
    expect(doc.querySelector("style[data-forgemark='anchors']")?.textContent).toContain("#ff0");
  });

  it("highlights a passage inside the element that holds it, not the element", () => {
    init();
    const section = doc.querySelector("section#tiles")!;
    expect(section.hasAttribute("data-anchor-id")).toBe(false);
    const spans = Array.from(section.querySelectorAll("[data-anchor-id='3']"));
    expect(spans.map((s) => s.textContent).join("")).toBe("range 72%");
  });

  it("finds the passage again after the report redraws it", async () => {
    init();
    const section = doc.querySelector("section#tiles")!;
    section.innerHTML =
      '<div class="tile">Average 6.1</div><div class="tile">Time in range <b>72%</b> today</div>';
    await vi.advanceTimersByTimeAsync(100);
    const spans = Array.from(section.querySelectorAll("[data-anchor-id='3']"));
    expect(spans.map((s) => s.textContent).join("")).toBe("range 72%");
  });

  it("puts a comment button beside each block, and only the outermost", () => {
    init();
    const buttons = Array.from(doc.querySelectorAll("button[data-forgemark='block']"));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Comment on Figure 1. Control holds",
      "Comment on table: Head",
    ]);
  });
});

describe("what the reader does", () => {
  it("reports a selection with its surroundings and containers", () => {
    init();
    select("Control holds");
    doc.dispatchEvent(new Event("selectionchange"));
    const last = sent[sent.length - 1];
    expect(last.type).toBe("selection");
    if (last.type !== "selection" || !last.selection) throw new Error("no selection");
    expect(last.selection.text).toBe("Control holds");
    expect(last.selection.contextBefore).toContain("Figure 1.");
    expect(last.selection.containerIds).toEqual(["fig-1"]);
    expect(last.selection.overlappingAnchorId).toBe(2);
  });

  it("wraps a captured range with markers when its comment arrives, and unwraps on request", () => {
    init([]);
    select("Trailing prose");
    doc.dispatchEvent(new Event("selectionchange"));
    const capture = sent.filter((m) => m.type === "selection").pop();
    if (!capture || capture.type !== "selection" || !capture.selection)
      throw new Error("no capture");
    tell({ type: "wrap", token: capture.selection.token, id: 9, kind: "inline" });
    const html = doc.body.innerHTML;
    expect(html).toContain("<!-- fmc:9 -->");
    expect(doc.querySelector("[data-anchor-id='9']")?.textContent).toBe("Trailing prose");
    tell({ type: "unwrap", id: 9 });
    expect(doc.body.innerHTML).not.toContain("fmc:9");
    expect(doc.querySelector("[data-anchor-id='9']")).toBeNull();
  });

  it("captures a block from its button and wraps the element when asked", () => {
    init([]);
    const buttons = doc.querySelectorAll<HTMLButtonElement>("button[data-forgemark='block']");
    buttons[1].click();
    const capture = sent.filter((m) => m.type === "elementCapture").pop();
    if (!capture || capture.type !== "elementCapture") throw new Error("no capture");
    expect(capture.element.elementId).toBe("t1");
    expect(capture.element.description).toBe("table: Head");
    expect(capture.element.existingAnchorId).toBeNull();
    tell({ type: "wrap", token: capture.element.token, id: 4, kind: "element" });
    expect(doc.querySelector("table[data-anchor-id='4']")).not.toBeNull();
    expect(doc.body.innerHTML).toContain("<!-- fmc:4 --><table");
    // The figure's own markers make it an existing anchor.
    buttons[0].click();
    const again = sent.filter((m) => m.type === "elementCapture").pop();
    if (!again || again.type !== "elementCapture") throw new Error("no capture");
    expect(again.element.existingAnchorId).toBe(2);
  });

  it("wraps a passage as one from the start and finds it again after a redraw", async () => {
    init([]);
    select("1h 05m");
    doc.dispatchEvent(new Event("selectionchange"));
    const capture = sent.filter((m) => m.type === "selection").pop();
    if (!capture || capture.type !== "selection" || !capture.selection)
      throw new Error("no capture");
    expect(capture.selection.contextBefore).toContain("Deep sleep");
    expect(capture.selection.containerIds).toEqual(["tiles2"]);
    tell({
      type: "wrap",
      token: capture.selection.token,
      id: 8,
      kind: "passage",
      text: "1h 05m",
      selector: "#tiles2",
    });
    const section = doc.querySelector("section#tiles2")!;
    // The markers go around the section, as in the source; the section
    // holds the passage and is not itself an anchor.
    expect(doc.body.innerHTML).toMatch(/<!-- fmc:8 --><section id="tiles2"[^>]*>/);
    expect(section.hasAttribute("data-anchor-id")).toBe(false);
    expect(section.getAttribute("data-fm-passage-host")).toBe("8");
    expect(section.querySelector("[data-anchor-id='8']")?.textContent).toBe("1h 05m");
    // The report redraws the section, as a tab switch does.
    section.innerHTML =
      '<div class="tile">Average <b>7h 12m</b></div><div class="tile">Deep sleep <b>1h 05m</b> today</div>';
    await vi.advanceTimersByTimeAsync(100);
    expect(section.querySelector("[data-anchor-id='8']")?.textContent).toBe("1h 05m");
  });

  it("shows each of several passages on one element as its text comes and goes", async () => {
    // Two comments on one block: the content of one tab, and of another.
    const table = doc.querySelector("table#t1")!;
    table.insertAdjacentHTML("beforebegin", "<!-- fmc:11 --><!-- fmc:12 -->");
    table.insertAdjacentHTML("afterend", "<!-- /fmc:12 --><!-- /fmc:11 -->");
    init([
      { id: 11, kind: "passage", text: "Head 42" },
      { id: 12, kind: "passage", text: "Head 43" },
    ]);
    // The whole block reads as the first passage: it is marked as a block.
    expect(table.getAttribute("data-anchor-id")).toBe("11");
    expect(table.getAttribute("data-fm-passage-host")!.split(" ").sort()).toEqual(["11", "12"]);
    table.querySelector("td")!.textContent = "43";
    await vi.advanceTimersByTimeAsync(100);
    expect(table.getAttribute("data-anchor-id")).toBe("12");
    table.querySelector("td")!.textContent = "44";
    await vi.advanceTimersByTimeAsync(100);
    expect(table.hasAttribute("data-anchor-id")).toBe(false);
    tell({ type: "unwrap", id: 11 });
    expect(table.getAttribute("data-fm-passage-host")).toBe("12");
  });

  it("marks a figure as a block when the passage is its caption, axis labels and all", async () => {
    const figure = doc.querySelector("figure#fig-1")!;
    figure.querySelector("svg")!.innerHTML = "<text>1</text><text>2</text>";
    figure.insertAdjacentHTML("beforebegin", "<!-- fmc:21 -->");
    figure.insertAdjacentHTML("afterend", "<!-- /fmc:21 -->");
    // The fixture's own pair 2 is outside; pair 21 is the passage.
    init([
      { id: 2, kind: "element" },
      { id: 21, kind: "passage", text: "Figure 1. Control holds" },
    ]);
    // Pair 2 marks the figure as its block; the passage cannot also.
    expect(figure.getAttribute("data-anchor-id")).toBe("2");
    tell({ type: "unwrap", id: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(figure.getAttribute("data-anchor-id")).toBe("21");
    figure.querySelector("figcaption")!.textContent = "Figure 1. Sleep holds";
    await vi.advanceTimersByTimeAsync(100);
    expect(figure.hasAttribute("data-anchor-id")).toBe(false);
  });

  it("puts a space between blocks in a selection's surroundings", () => {
    init([]);
    select("42");
    doc.dispatchEvent(new Event("selectionchange"));
    const capture = sent.filter((m) => m.type === "selection").pop();
    if (!capture || capture.type !== "selection" || !capture.selection)
      throw new Error("no capture");
    expect(capture.selection.contextBefore).toMatch(/fragment\. Head$/);
  });

  it("forwards clicks on anchors and links, and follows a fragment itself", () => {
    init();
    (doc.querySelector("[data-anchor-id='1']") as HTMLElement).click();
    expect(sent.pop()).toEqual({ type: "anchorClick", id: 1 });
    (doc.querySelector("a[href='https://x.y/p']") as HTMLElement).click();
    expect(sent.pop()).toEqual({ type: "link", href: "https://x.y/p" });
    const target = doc.getElementById("fig-1") as HTMLElement;
    target.scrollIntoView = vi.fn();
    (doc.querySelector("a[href='#fig-1']") as HTMLElement).click();
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(sent[sent.length - 1].type).not.toBe("link");
  });

  it("reflects focus changes without a reload", () => {
    init();
    tell({ type: "state", state: { focused: 2, hovered: 1, resolved: [] } });
    expect(doc.querySelector("[data-anchor-id='1']")?.classList.contains("is-focused")).toBe(false);
    expect(doc.querySelector("[data-anchor-id='1']")?.classList.contains("is-hovered")).toBe(true);
    expect(doc.querySelector("[data-anchor-id='2']")?.classList.contains("is-focused")).toBe(true);
  });
});
