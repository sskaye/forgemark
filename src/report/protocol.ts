// What the report frame and the app say to each other.
//
// A report runs on its own origin, in a frame the app cannot reach
// into. Everything the review needs from inside it — where the reader
// selected, which anchor they clicked, that a link was followed — comes
// out as a message, and everything the frame needs from the app — the
// comments to highlight, which one is focused, the theme — goes in as
// one. The bridge (bridge.ts) speaks for the frame; HtmlView speaks for
// the app.

// A comment as the frame needs it: which pair of markers is whose, and
// for a passage anchor, the text to find inside the wrapped element.
export type FrameComment = {
  id: number;
  kind: "inline" | "element" | "passage";
  text?: string;
};

export type FrameState = {
  focused: number | null;
  hovered: number | null;
  resolved: number[];
};

export type FrameTheme = {
  name: string;
  stylesheet: string;
};

// A rectangle in the frame's own viewport coordinates.
export type FrameRect = { left: number; top: number; right: number; bottom: number };

// What the reader selected. `token` names the frame's own record of the
// range, so the app can later ask for the markers to go around exactly
// that. `containerIds` are the ids of the elements enclosing the
// selection, innermost first, for anchoring a passage a script produced.
export type FrameSelection = {
  token: string;
  text: string;
  contextBefore: string;
  contextAfter: string;
  containerIds: string[];
  overlappingAnchorId: number | null;
  rect: FrameRect;
};

// A block the reader asked to comment on as a unit.
export type FrameElement = {
  token: string;
  tag: string;
  description: string;
  // The element's own id, when it has a usable one.
  elementId: string | null;
  containerIds: string[];
  // The start of its rendered text, for finding it in the source when
  // it has no id.
  textHead: string;
  existingAnchorId: number | null;
  rect: FrameRect;
};

export type BridgeToHost =
  | { type: "ready" }
  | { type: "selection"; selection: FrameSelection | null }
  | { type: "anchorClick"; id: number | null }
  | { type: "anchorHover"; id: number | null }
  | { type: "contextmenu"; x: number; y: number }
  | { type: "link"; href: string }
  | { type: "elementCapture"; element: FrameElement };

export type HostToBridge =
  | { type: "init"; theme: FrameTheme; state: FrameState; comments: FrameComment[] }
  | { type: "theme"; theme: FrameTheme }
  | { type: "state"; state: FrameState }
  | { type: "comments"; comments: FrameComment[] }
  // Put marker comments around the range or element the token names,
  // for a comment of this kind. A passage's markers go around the
  // element its selector names, as they do in the source, and its text
  // is what to highlight inside it.
  | {
      type: "wrap";
      token: string;
      id: number;
      kind: FrameComment["kind"];
      text?: string;
      selector?: string;
    }
  // Take the markers for a comment out again.
  | { type: "unwrap"; id: number }
  | { type: "scrollTo"; id: number }
  | { type: "scrollToFragment"; id: string };

// Both ends see the same shape: send one way, listen the other.
export type Channel<Out, In> = {
  send(message: Out): void;
  onMessage(listener: (message: In) => void): () => void;
};

export type BridgeChannel = Channel<BridgeToHost, HostToBridge>;
export type HostChannel = Channel<HostToBridge, BridgeToHost>;
