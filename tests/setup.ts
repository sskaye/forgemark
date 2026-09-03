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

beforeEach(() => {
  fake.reset();
});
