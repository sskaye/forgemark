import { describe, it, expect } from "vitest";
import {
  classifyLink,
  dirOf,
  isRelativeRef,
  resolvePath,
  resolveResource,
  slugger,
} from "../../src/services/documentLinks";

describe("dirOf", () => {
  it("gives the folder of a path on either platform", () => {
    expect(dirOf("/docs/notes/a.md")).toBe("/docs/notes");
    expect(dirOf("C:\\docs\\a.md")).toBe("C:\\docs");
    expect(dirOf("/a.md")).toBe("/");
    expect(dirOf(null)).toBe(null);
    expect(dirOf("a.md")).toBe(null);
  });
});

describe("resolvePath", () => {
  it("folds . and .. and decodes percent escapes", () => {
    expect(resolvePath("/docs/notes", "images/x.png")).toBe("/docs/notes/images/x.png");
    expect(resolvePath("/docs/notes", "./x.png")).toBe("/docs/notes/x.png");
    expect(resolvePath("/docs/notes", "../shared/y%20z.png")).toBe("/docs/shared/y z.png");
    expect(resolvePath("/docs", "../../../x")).toBe("/x");
    expect(resolvePath("/docs", "/abs/x.png")).toBe("/abs/x.png");
    expect(resolvePath("C:\\docs\\notes", "..\\x.png".replace("\\", "/"))).toBe("C:\\docs\\x.png");
  });

  it("drops a query and fragment", () => {
    expect(resolvePath("/docs", "other.md#sec?x=1")).toBe("/docs/other.md");
  });
});

describe("isRelativeRef and resolveResource", () => {
  it("tells a relative reference from an address, fragment, or data", () => {
    expect(isRelativeRef("images/x.png")).toBe(true);
    expect(isRelativeRef("/abs.png")).toBe(true);
    expect(isRelativeRef("https://x.y/a.png")).toBe(false);
    expect(isRelativeRef("data:image/png;base64,AAAA")).toBe(false);
    expect(isRelativeRef("#top")).toBe(false);
    expect(isRelativeRef("//cdn.x/y.png")).toBe(false);
  });

  it("turns a relative reference into an asset URL and leaves the rest alone", () => {
    expect(resolveResource("/docs", "images/x.png")).toBe(
      "asset://localhost/" + encodeURIComponent("/docs/images/x.png"),
    );
    expect(resolveResource("/docs", "https://x.y/a.png")).toBe("https://x.y/a.png");
    expect(resolveResource(null, "images/x.png")).toBe("images/x.png");
  });
});

describe("classifyLink", () => {
  it("sorts links by what a click should do", () => {
    expect(classifyLink("https://x.y/p", "/docs")).toEqual({
      kind: "external",
      url: "https://x.y/p",
    });
    expect(classifyLink("mailto:a@b.c", "/docs")).toEqual({
      kind: "external",
      url: "mailto:a@b.c",
    });
    expect(classifyLink("#my-heading", "/docs")).toEqual({ kind: "fragment", id: "my-heading" });
    expect(classifyLink("./other.md#sec", "/docs")).toEqual({
      kind: "document",
      path: "/docs/other.md",
      fragment: "sec",
    });
    expect(classifyLink("report.html", "/docs")).toEqual({
      kind: "document",
      path: "/docs/report.html",
      fragment: null,
    });
    expect(classifyLink("data/results.csv", "/docs")).toEqual({
      kind: "file",
      path: "/docs/data/results.csv",
    });
    expect(classifyLink("javascript:alert(1)", "/docs")).toEqual({ kind: "none" });
    expect(classifyLink("", "/docs")).toEqual({ kind: "none" });
    expect(classifyLink("other.md", null)).toEqual({ kind: "none" });
  });
});

describe("slugger", () => {
  it("makes GitHub's heading ids, with repeats numbered", () => {
    const slug = slugger();
    expect(slug("My Heading")).toBe("my-heading");
    expect(slug("What's new? (v2.0)")).toBe("whats-new-v20");
    expect(slug("My Heading")).toBe("my-heading-1");
    expect(slug("Ünïcode ok")).toBe("ünïcode-ok");
  });
});
