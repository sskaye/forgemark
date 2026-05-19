import { describe, expect, it } from "vitest";
import { normalizeExternalUrl } from "../../src/services/externalLinks";

describe("external link filtering", () => {
  it("allows browser and app URL protocols", () => {
    expect(normalizeExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(normalizeExternalUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(normalizeExternalUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(normalizeExternalUrl("tel:+15551234567")).toBe("tel:+15551234567");
  });

  it("rejects relative, fragment, file, and script URLs", () => {
    expect(normalizeExternalUrl("./relative.md")).toBeNull();
    expect(normalizeExternalUrl("#section")).toBeNull();
    expect(normalizeExternalUrl("file:///tmp/x.md")).toBeNull();
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
  });
});
