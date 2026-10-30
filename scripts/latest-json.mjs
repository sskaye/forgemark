// The manifest Tauri's updater reads: `latest.json`, attached to every
// release. The app fetches it from the latest release
// (`releases/latest/download/latest.json`, tauri.conf.json), compares
// the version with its own, and downloads the file listed for its
// platform, which it verifies against `signature` with the public key
// it was built with.
//
// The updater looks a platform up as `{os}-{arch}-{installer}` first and
// `{os}-{arch}` second, so both are listed: Windows updates the NSIS
// -setup.exe (an install from an .msi, which releases no longer carry,
// falls back to it), the universal macOS update serves both
// architectures, and Linux updates the AppImage.

const RELEASES = "https://github.com/sskaye/forgemark/releases/download";

// The update files a release carries, and the platforms each serves.
export function updateAssets(version) {
  const v = version;
  const mac = `Forgemark_${v}_universal.app.tar.gz`;
  const nsis = `Forgemark_${v}_x64-setup.exe`;
  const appX64 = `Forgemark_${v}_amd64.AppImage`;
  const appArm = `Forgemark_${v}_aarch64.AppImage`;
  return {
    [mac]: ["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"],
    [nsis]: ["windows-x86_64", "windows-x86_64-nsis"],
    [appX64]: ["linux-x86_64", "linux-x86_64-appimage"],
    [appArm]: ["linux-aarch64", "linux-aarch64-appimage"],
  };
}

// `signatures`: file name → the text of its `.sig`. Every update file
// must have one; a missing signature is an error, not a gap, because an
// app on that platform would fail to update with no way to tell why.
export function buildLatestJson({ version, notes, pubDate, signatures }) {
  const platforms = {};
  for (const [file, keys] of Object.entries(updateAssets(version))) {
    const signature = signatures[file];
    if (!signature) throw new Error(`No signature for ${file}.`);
    const entry = { signature: signature.trim(), url: `${RELEASES}/v${version}/${file}` };
    for (const key of keys) platforms[key] = entry;
  }
  return { version, notes, pub_date: pubDate, platforms };
}

// The release's own section of the changelog, for the updater's notes.
export function changelogSection(changelog, version) {
  const head = `## [${version}]`;
  const at = changelog.indexOf(head);
  if (at < 0) return "";
  const from = changelog.indexOf("\n", at) + 1;
  const next = changelog.indexOf("\n## [", from);
  return changelog.slice(from, next < 0 ? undefined : next).trim();
}
