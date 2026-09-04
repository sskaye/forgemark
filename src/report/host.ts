// The app's side of a report frame: get the report onto its own origin
// with the bridge inside it, and talk to the bridge.
//
// In the app, the report is handed to Rust (`set_report`), which serves
// it — and any file beside it — under a custom protocol, so the frame
// has an origin of its own and the report's scripts run as they would
// in a browser, with no way to reach the app. The bridge script is
// spliced into the report before it goes, and the two sides talk over
// postMessage. Tests install a loader that writes the report into the
// frame directly and wires the bridge to the host without a protocol.

import { invoke } from "@tauri-apps/api/core";
import type { BridgeToHost, HostChannel, HostToBridge } from "./protocol";
import bridgeSource from "./report-bridge.built.js?raw";

export type ReportLoad = { html: string; baseDir: string | null };

export type ReportConnection = HostChannel & { dispose(): void };

export type ReportLoader = (
  frame: HTMLIFrameElement,
  load: ReportLoad,
) => Promise<ReportConnection>;

let loader: ReportLoader | null = null;

// For tests: replace how a report gets into a frame.
export function setReportLoader(next: ReportLoader | null): void {
  loader = next;
}

// Every loader gets the report with the bridge already inside it.
export function loadReport(frame: HTMLIFrameElement, load: ReportLoad): Promise<ReportConnection> {
  return (loader ?? tauriLoader)(frame, { ...load, html: withBridge(load.html) });
}

// The report with the bridge inside it, placed where the parser sees it
// before any of the report's own scripts: right after `<head>`, or at
// the top when there is no head.
export function withBridge(html: string, source: string = bridgeSource): string {
  const tag = `<script data-forgemark="bridge">${source.replace(/<\/script/gi, "<\\/script")}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

let reportCount = 0;

const tauriLoader: ReportLoader = async (frame, load) => {
  const id = `r${++reportCount}-${Date.now().toString(36)}`;
  await invoke("set_report", { id, html: load.html, baseDir: load.baseDir });
  const channel = frameChannel(frame);
  const ready = new Promise<void>((resolve) => {
    const off = channel.onMessage((message) => {
      if (message.type === "ready") {
        off();
        resolve();
      }
    });
  });
  frame.src = reportUrl(id);
  await ready;
  return {
    ...channel,
    dispose() {
      channel.dispose();
      void invoke("clear_report", { id }).catch(() => undefined);
    },
  };
};

// Where the protocol serves a report. Windows cannot use a custom
// scheme directly and gets the `http://<scheme>.localhost` form.
export function reportUrl(id: string): string {
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return windows
    ? `http://fmreport.localhost/${encodeURIComponent(id)}/index.html`
    : `fmreport://localhost/${encodeURIComponent(id)}/index.html`;
}

// A channel over postMessage to the frame's window. Only that window is
// listened to; a custom-scheme origin may serialize as "null", so the
// source, not the origin, is what identifies it.
export function frameChannel(frame: HTMLIFrameElement): HostChannel & { dispose(): void } {
  const listeners = new Set<(message: BridgeToHost) => void>();
  const handler = (e: MessageEvent) => {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    if (!e.data || typeof e.data !== "object" || typeof e.data.type !== "string") return;
    for (const listener of Array.from(listeners)) listener(e.data as BridgeToHost);
  };
  window.addEventListener("message", handler);
  return {
    send(message: HostToBridge) {
      frame.contentWindow?.postMessage(message, "*");
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      window.removeEventListener("message", handler);
      listeners.clear();
    },
  };
}
