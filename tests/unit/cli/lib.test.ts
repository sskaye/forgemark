import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseForgemarkFile, serializeForgemarkFile } from "../../../src/format";
import {
  addComment,
  addReply,
  setResolved,
  deleteComment,
  floatComment,
  reattachComment,
  listComments,
  CommandError,
} from "../../../cli/lib";

const FIXTURES = resolve(__dirname, "..", "..", "ai", "fixtures");
// The shipped sample with a genuinely lost anchor (fixture 04's "orphan"
// is a drifted description, not a missing marker pair).
const LOST_ANCHOR = resolve(__dirname, "..", "..", "..", "assets", "sample-lost-anchor.md");
const NOW = "2026-09-03T12:00:00Z";

function load(name: string) {
  const path = name.startsWith("/") ? name : resolve(FIXTURES, name);
  const text = readFileSync(path, "utf8");
  return parseForgemarkFile(text, { tolerant: true });
}

// Every operation must produce a file the strict parser accepts and
// that serializes to bytes which parse back to the same records.
function roundTrips(file: ReturnType<typeof load>) {
  const text = serializeForgemarkFile(file);
  const back = parseForgemarkFile(text);
  expect(back.comments).toEqual(file.comments);
  expect(back.body).toBe(file.body);
  return text;
}

describe("addComment", () => {
  it("anchors a new comment with the next id and rendered anchor fields", () => {
    const file = load("02-with-thread.md");
    const r = addComment(file, "markdown", {
      author: "Claude",
      body: "Which size buckets?",
      anchor: "controlling for company size",
      now: NOW,
    });
    expect(r.id).toBe(2);
    expect(r.summary).toMatch(/Added comment #2/);
    const c = r.file.comments[1];
    expect(c).toMatchObject({
      id: 2,
      author: "Claude",
      timestamp: NOW,
      resolved: false,
      anchor_text: "controlling for company size",
      body: "Which size buckets?\n",
    });
    expect(r.file.body).toContain("<!-- fmc:2 -->controlling for company size<!-- /fmc:2 -->");
    roundTrips(r.file);
  });

  it("writes a body containing a colon and a comment-closer safely", () => {
    const file = load("01-simple.md");
    const body = "The report: Purpose, Method --> and <!-- more.";
    const r = addComment(file, "markdown", { author: "Claude", body, floating: true, now: NOW });
    const text = roundTrips(r.file);
    expect(text).not.toMatch(/^\s*body: The report/m);
    expect(parseForgemarkFile(text).comments.at(-1)?.body).toBe(body + "\n");
  });

  it("adds a floating note without markers", () => {
    const file = load("01-simple.md");
    const before = file.body;
    const r = addComment(file, "markdown", {
      author: "Claude",
      body: "General note.",
      floating: true,
      now: NOW,
    });
    expect(r.file.body).toBe(before);
    expect(r.file.comments.at(-1)).toMatchObject({ floating: true, body: "General note.\n" });
    expect(r.file.comments.at(-1)?.anchor_text).toBeUndefined();
    roundTrips(r.file);
  });

  it("makes a suggestion whose `from` is the exact source the app will replace", () => {
    const file = load("02-with-thread.md");
    const r = addComment(file, "markdown", {
      author: "Claude",
      anchor: "controlling for company size",
      suggest: "adjusting for company size",
      now: NOW,
    });
    const c = r.file.comments.at(-1)!;
    expect(c.suggested_edit).toEqual({
      from: "controlling for company size",
      to: "adjusting for company size",
    });
    expect(c.body).toBeUndefined();
    roundTrips(r.file);
  });

  it("refuses to do without a body, or with two placements", () => {
    const file = load("01-simple.md");
    expect(() => addComment(file, "markdown", { author: "C", anchor: "x", now: NOW })).toThrow(
      /needs a body/,
    );
    expect(() =>
      addComment(file, "markdown", {
        author: "C",
        body: "b",
        anchor: "x",
        floating: true,
        now: NOW,
      }),
    ).toThrow(/exactly one/);
    expect(() =>
      addComment(file, "markdown", { author: "C", suggest: "y", floating: true, now: NOW }),
    ).toThrow(/--suggest needs --anchor/);
  });

  it("turns an anchor error into a command error the agent can act on", () => {
    const file = load("02-with-thread.md");
    expect(() =>
      addComment(file, "markdown", { author: "C", body: "b", anchor: "twice the rate", now: NOW }),
    ).toThrow(CommandError);
    expect(() =>
      addComment(file, "markdown", { author: "C", body: "b", anchor: "twice the rate", now: NOW }),
    ).toThrow(/Reply to comment 1/);
  });

  it("refuses an HTML suggestion that would span tags", () => {
    const html = "<html><body><p>A <b>bold</b> claim.</p></body></html>\n";
    const file = { body: html, comments: [] };
    expect(() =>
      addComment(file, "html", { author: "C", anchor: "A bold claim", suggest: "x", now: NOW }),
    ).toThrow(/must not span tags/);
    const ok = addComment(file, "html", {
      author: "C",
      anchor: "claim",
      suggest: "point",
      now: NOW,
    });
    expect(ok.file.comments[0].suggested_edit).toEqual({ from: "claim", to: "point" });
  });
});

describe("addReply", () => {
  it("appends to the existing replies list, in order", () => {
    const file = load("02-with-thread.md");
    const r = addReply(file, 1, { author: "Claude", body: "Numbers added.", now: NOW });
    const replies = r.file.comments[0].replies!;
    expect(replies).toHaveLength(3);
    expect(replies[2]).toEqual({ author: "Claude", timestamp: NOW, body: "Numbers added.\n" });
    const text = roundTrips(r.file);
    // One `replies:` key, not a second one appended below the first.
    expect(text.match(/^\s+replies:/gm)).toHaveLength(1);
  });

  it("starts a replies list on a comment that has none", () => {
    const file = load("01-simple.md");
    const r = addReply(file, 2, { author: "Claude", body: "Agreed.", now: NOW });
    expect(r.file.comments.find((c) => c.id === 2)?.replies).toHaveLength(1);
    roundTrips(r.file);
  });

  it("names the available ids when the id is unknown", () => {
    const file = load("01-simple.md");
    expect(() => addReply(file, 9, { author: "C", body: "b", now: NOW })).toThrow(/ids: 1, 2/);
  });
});

describe("state changes", () => {
  it("resolves and reopens", () => {
    const file = load("01-simple.md");
    const resolved = setResolved(file, 1, true);
    expect(resolved.file.comments[0].resolved).toBe(true);
    expect(resolved.file.body).toBe(file.body);
    const reopened = setResolved(resolved.file, 1, false);
    expect(reopened.file.comments[0].resolved).toBe(false);
    roundTrips(reopened.file);
  });

  it("deletes the record and its markers", () => {
    const file = load("01-simple.md");
    const r = deleteComment(file, 1);
    expect(r.file.comments.map((c) => c.id)).toEqual([2]);
    expect(r.file.body).not.toMatch(/fmc:1\b/);
    roundTrips(r.file);
  });

  it("floats an orphan: markers gone, anchor fields cleared, floating set", () => {
    const file = load(LOST_ANCHOR);
    const orphan = listComments(file, "markdown").find((e) => e.status === "orphaned")!;
    const r = floatComment(file, orphan.comment.id);
    const c = r.file.comments.find((x) => x.id === orphan.comment.id)!;
    expect(c.floating).toBe(true);
    expect(c.anchor_text).toBeUndefined();
    expect(c.context_before).toBeUndefined();
    expect(listComments(r.file, "markdown").every((e) => e.status !== "orphaned")).toBe(true);
    roundTrips(r.file);
  });

  it("refuses to float a note twice", () => {
    const file = load("04-orphan-and-floating.md");
    const note = file.comments.find((c) => c.floating)!;
    expect(() => floatComment(file, note.id)).toThrow(/already a floating note/);
  });

  it("reattaches an orphan to a new passage", () => {
    const file = load(LOST_ANCHOR);
    const orphan = listComments(file, "markdown").find((e) => e.status === "orphaned")!;
    const phrase = file.body
      .split("\n")
      .find((l) => l.length > 40)!
      .split(" ")
      .slice(0, 3)
      .join(" ");
    const r = reattachComment(file, "markdown", orphan.comment.id, { anchor: phrase });
    const entry = listComments(r.file, "markdown").find((e) => e.comment.id === orphan.comment.id)!;
    expect(entry.status).toBe("attached");
    expect(entry.comment.anchor_text).toBe(phrase);
    expect(entry.comment.floating).toBeUndefined();
    roundTrips(r.file);
  });

  it("refuses to reattach a comment that is already anchored", () => {
    const file = load("01-simple.md");
    expect(() => reattachComment(file, "markdown", 1, { anchor: "x" })).toThrow(/already anchored/);
  });
});

describe("listComments", () => {
  it("reports status and the current text between markers", () => {
    const kinds = [
      ...listComments(load(LOST_ANCHOR), "markdown"),
      ...listComments(load("04-orphan-and-floating.md"), "markdown"),
    ].map((e) => e.status);
    expect(kinds).toContain("orphaned");
    expect(kinds).toContain("floating");
    const attached = listComments(load("01-simple.md"), "markdown")[0];
    expect(attached.status).toBe("attached");
    expect(attached.current).toBe(attached.comment.anchor_text);
  });
});
