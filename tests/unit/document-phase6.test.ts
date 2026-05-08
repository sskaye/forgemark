import { describe, it, expect } from "vitest";
import { reduceDocument, INITIAL_STATE } from "../../src/state/document";
import type { Comment, Reply } from "../../src/format/types";

const aComment = (id: number, overrides: Partial<Comment> = {}): Comment => ({
  id,
  author: "Maya",
  timestamp: "2026-05-07T09:00:00Z",
  resolved: false,
  body: "alpha\n",
  anchor_text: `text${id}`,
  ...overrides,
});

const reply = (overrides: Partial<Reply> = {}): Reply => ({
  author: "Claude",
  timestamp: "2026-05-07T10:00:00Z",
  body: "reply\n",
  ...overrides,
});

const baseLoaded = () =>
  reduceDocument(INITIAL_STATE, {
    type: "load",
    filePath: "/tmp/x.md",
    fileName: "x.md",
    text: "x",
    body: "x",
    comments: [aComment(1), aComment(2, { author: "Devon" })],
    readOnly: false,
  });

describe("reducer — addReply", () => {
  it("appends a reply to the matching comment", () => {
    const next = reduceDocument(baseLoaded(), {
      type: "addReply",
      commentId: 1,
      reply: reply(),
    });
    expect(next.comments[0].replies?.length).toBe(1);
    expect(next.dirty).toBe(true);
    expect(next.composer).toBe(null);
    expect(next.focusedCommentId).toBe(1);
  });
  it("doesn't touch other comments", () => {
    const next = reduceDocument(baseLoaded(), {
      type: "addReply",
      commentId: 1,
      reply: reply(),
    });
    expect(next.comments[1].replies).toBeUndefined();
  });
});

describe("reducer — editComment / editReply", () => {
  it("editComment updates body and sets edited_at", () => {
    const next = reduceDocument(baseLoaded(), {
      type: "editComment",
      commentId: 1,
      body: "updated\n",
      editedAt: "2026-05-08T00:00:00Z",
    });
    expect(next.comments[0].body).toBe("updated\n");
    expect(next.comments[0].edited_at).toBe("2026-05-08T00:00:00Z");
    expect(next.comments[0].timestamp).toBe("2026-05-07T09:00:00Z"); // untouched
    expect(next.dirty).toBe(true);
  });

  it("editReply updates the indexed reply only", () => {
    const withReplies = reduceDocument(baseLoaded(), {
      type: "addReply",
      commentId: 1,
      reply: reply({ body: "first\n", timestamp: "2026-05-07T10:00:00Z" }),
    });
    const more = reduceDocument(withReplies, {
      type: "addReply",
      commentId: 1,
      reply: reply({ body: "second\n", timestamp: "2026-05-07T11:00:00Z" }),
    });
    const next = reduceDocument(more, {
      type: "editReply",
      commentId: 1,
      replyIndex: 0,
      body: "first edited\n",
      editedAt: "2026-05-08T01:00:00Z",
    });
    expect(next.comments[0].replies?.[0].body).toBe("first edited\n");
    expect(next.comments[0].replies?.[0].edited_at).toBe("2026-05-08T01:00:00Z");
    expect(next.comments[0].replies?.[1].body).toBe("second\n");
    expect(next.comments[0].replies?.[1].edited_at).toBeUndefined();
  });
});

describe("reducer — toggleResolved", () => {
  it("flips resolved on the matching comment only", () => {
    const next = reduceDocument(baseLoaded(), {
      type: "toggleResolved",
      commentId: 2,
    });
    expect(next.comments[0].resolved).toBe(false);
    expect(next.comments[1].resolved).toBe(true);
    expect(next.dirty).toBe(true);
  });
  it("toggles back when called twice", () => {
    const once = reduceDocument(baseLoaded(), {
      type: "toggleResolved",
      commentId: 1,
    });
    const twice = reduceDocument(once, {
      type: "toggleResolved",
      commentId: 1,
    });
    expect(twice.comments[0].resolved).toBe(false);
  });
});

describe("reducer — deleteComment", () => {
  it("removes the comment and updates the body", () => {
    const next = reduceDocument(baseLoaded(), {
      type: "deleteComment",
      commentId: 1,
      body: "x without markers",
    });
    expect(next.comments).toHaveLength(1);
    expect(next.comments[0].id).toBe(2);
    expect(next.body).toBe("x without markers");
    expect(next.dirty).toBe(true);
  });
  it("clears focusedCommentId when deleting the focused comment", () => {
    const focused = reduceDocument(baseLoaded(), {
      type: "setFocusedComment",
      id: 1,
    });
    const next = reduceDocument(focused, {
      type: "deleteComment",
      commentId: 1,
      body: "x",
    });
    expect(next.focusedCommentId).toBe(null);
  });
  it("preserves focusedCommentId when deleting a different comment", () => {
    const focused = reduceDocument(baseLoaded(), {
      type: "setFocusedComment",
      id: 2,
    });
    const next = reduceDocument(focused, {
      type: "deleteComment",
      commentId: 1,
      body: "x",
    });
    expect(next.focusedCommentId).toBe(2);
  });
  it("cascades replies — deleting a parent removes all of its replies", () => {
    const start = reduceDocument(baseLoaded(), {
      type: "addReply",
      commentId: 1,
      reply: reply(),
    });
    const next = reduceDocument(start, {
      type: "deleteComment",
      commentId: 1,
      body: "x",
    });
    expect(next.comments.find((c) => c.id === 1)).toBeUndefined();
    // The replies are gone with their parent (cascade).
    const everyReply = next.comments.flatMap((c) => c.replies ?? []);
    expect(everyReply).toHaveLength(0);
  });
});

describe("reducer — deleteReply", () => {
  it("removes the indexed reply and dirties the doc", () => {
    const start = reduceDocument(baseLoaded(), {
      type: "addReply",
      commentId: 1,
      reply: reply({ body: "first\n" }),
    });
    const more = reduceDocument(start, {
      type: "addReply",
      commentId: 1,
      reply: reply({ body: "second\n" }),
    });
    const next = reduceDocument(more, {
      type: "deleteReply",
      commentId: 1,
      replyIndex: 0,
    });
    expect(next.comments[0].replies).toHaveLength(1);
    expect(next.comments[0].replies?.[0].body).toBe("second\n");
    expect(next.dirty).toBe(true);
  });
});

describe("reducer — filter / sort", () => {
  it("setFilter persists across loads", () => {
    const filtered = reduceDocument(baseLoaded(), {
      type: "setFilter",
      filter: { kind: "open" },
    });
    expect(filtered.filter).toEqual({ kind: "open" });
    const reloaded = reduceDocument(filtered, {
      type: "load",
      filePath: "/tmp/y.md",
      fileName: "y.md",
      text: "y",
      body: "y",
      comments: [],
      readOnly: false,
    });
    expect(reloaded.filter).toEqual({ kind: "open" });
  });
  it("setSort persists across loads", () => {
    const sorted = reduceDocument(baseLoaded(), {
      type: "setSort",
      sort: "newest",
    });
    expect(sorted.sort).toBe("newest");
    const reloaded = reduceDocument(sorted, {
      type: "load",
      filePath: "/tmp/y.md",
      fileName: "y.md",
      text: "y",
      body: "y",
      comments: [],
      readOnly: false,
    });
    expect(reloaded.sort).toBe("newest");
  });
});
