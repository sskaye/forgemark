// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildLatestJson, changelogSection, updateAssets } from "../../scripts/latest-json.mjs";

// The manifest the in-app updater reads. A wrong key or URL here strands
// every install on that platform, so the shape is pinned.

const V = "1.11.0";
const signatures = Object.fromEntries(
  Object.keys(updateAssets(V)).map((file) => [file, `sig-of-${file}\n`]),
);

describe("latest.json", () => {
  it("lists every platform the updater looks up, with the release's URL and signature", () => {
    const m = buildLatestJson({
      version: V,
      notes: "n",
      pubDate: "2026-10-21T00:00:00Z",
      signatures,
    });
    expect(m).toMatchObject({ version: V, notes: "n", pub_date: "2026-10-21T00:00:00Z" });
    const base = `https://github.com/sskaye/forgemark/releases/download/v${V}`;
    const mac = {
      url: `${base}/Forgemark_${V}_universal.app.tar.gz`,
      signature: `sig-of-Forgemark_${V}_universal.app.tar.gz`,
    };
    expect(m.platforms["darwin-aarch64"]).toEqual(mac);
    expect(m.platforms["darwin-x86_64"]).toEqual(mac);
    expect(m.platforms["windows-x86_64"].url).toBe(`${base}/Forgemark_${V}_x64-setup.exe`);
    expect(m.platforms["windows-x86_64-nsis"].url).toBe(`${base}/Forgemark_${V}_x64-setup.exe`);
    // No .msi: an MSI install falls back to the -setup.exe.
    expect(m.platforms["windows-x86_64-msi"]).toBeUndefined();
    expect(m.platforms["linux-x86_64"].url).toBe(`${base}/Forgemark_${V}_amd64.AppImage`);
    expect(m.platforms["linux-aarch64"].url).toBe(`${base}/Forgemark_${V}_aarch64.AppImage`);
    // Signatures are stored without the trailing newline a .sig file has.
    expect(m.platforms["linux-aarch64"].signature).not.toMatch(/\n$/);
  });

  it("refuses to leave a platform out", () => {
    const partial = { ...signatures };
    delete partial[`Forgemark_${V}_aarch64.AppImage`];
    expect(() =>
      buildLatestJson({ version: V, notes: "", pubDate: "x", signatures: partial }),
    ).toThrow(/No signature for Forgemark_1\.11\.0_aarch64\.AppImage/);
  });

  it("takes the release's own section of the changelog as its notes", () => {
    const changelog =
      "# Changelog\n\nIntro.\n\n## [1.11.0] — 2026-10-21\n\n### Added\n\n- Updates.\n\n## [1.10.2] — x\n\n- Old.\n";
    expect(changelogSection(changelog, "1.11.0")).toBe("### Added\n\n- Updates.");
    expect(changelogSection(changelog, "1.10.2")).toBe("- Old.");
    expect(changelogSection(changelog, "9.9.9")).toBe("");
  });
});
