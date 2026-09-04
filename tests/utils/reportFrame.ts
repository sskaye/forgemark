// A report frame for tests, without the protocol.
//
// In the app a report is served on its own origin and the bridge inside
// it talks to the host over postMessage. Under jsdom there is no
// protocol and no script execution in a frame, so this loader writes
// the report into the frame's document directly and installs the bridge
// on the frame's window itself, wired to the host through a pair of
// in-memory channels. Everything above the channel — decoration,
// selection capture, wrapping — is the real code.

import { installBridge } from "../../src/report/bridge";
import { setReportLoader, type ReportConnection, type ReportLoader } from "../../src/report/host";
import type { BridgeToHost, HostToBridge } from "../../src/report/protocol";

const BRIDGE_TAG = /<script data-forgemark="bridge">[\s\S]*?<\/script>/;

// What the last frame was given, for tests to check.
export let lastReportLoad: { html: string; baseDir: string | null } | null = null;

export const jsdomReportLoader: ReportLoader = async (frame, load) => {
  lastReportLoad = load;
  const doc = frame.contentDocument;
  if (!doc) throw new Error("frame has no document");
  doc.open();
  doc.write(load.html.replace(BRIDGE_TAG, ""));
  doc.close();

  const toHost = new Set<(m: BridgeToHost) => void>();
  const toBridge = new Set<(m: HostToBridge) => void>();
  const deliver = <T>(listeners: Set<(m: T) => void>, message: T) => {
    queueMicrotask(() => {
      for (const listener of Array.from(listeners)) listener(message);
    });
  };
  let ready: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  toHost.add((m) => {
    if (m.type === "ready") ready();
  });
  const uninstall = installBridge(frame.contentWindow as Window, {
    send: (m) => deliver(toHost, m),
    onMessage: (listener) => {
      toBridge.add(listener);
      return () => toBridge.delete(listener);
    },
  });
  await readyPromise;
  const connection: ReportConnection = {
    send: (m) => deliver(toBridge, m),
    onMessage: (listener) => {
      toHost.add(listener);
      return () => toHost.delete(listener);
    },
    dispose: () => {
      uninstall();
      toHost.clear();
      toBridge.clear();
    },
  };
  return connection;
};

export function installReportLoader(): void {
  setReportLoader(jsdomReportLoader);
}
