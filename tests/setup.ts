import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";
import { createFakeTauri } from "./utils/tauri-fake";

// One fake Tauri for every test. Files that need a module to behave
// differently still declare their own `vi.mock`, which takes precedence;
// most need nothing beyond `fakeTauri` from tests/utils/harness.
const fake = createFakeTauri();
(globalThis as unknown as { __forgemarkFakeTauri: typeof fake }).__forgemarkFakeTauri = fake;

vi.mock("@tauri-apps/plugin-fs", () => fake.fs);
vi.mock("@tauri-apps/plugin-dialog", () => fake.dialog);
vi.mock("@tauri-apps/plugin-opener", () => fake.opener);
vi.mock("@tauri-apps/api/core", () => fake.core);

// Report frames get their content written in and the bridge installed
// by hand, since jsdom has neither the protocol nor script execution.
// Imported after the fake exists: the loader reaches the mocked Tauri
// module, whose factory needs `fake`.
const { installReportLoader } = await import("./utils/reportFrame");
installReportLoader();

// CodeMirror measures text ranges when it has focus; jsdom has no layout.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as ReturnType<Range["getClientRects"]>;
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
}

beforeEach(() => {
  fake.reset();
});
