import { test } from "vitest";

// `flakyTest(name, fn)` is a thin wrapper around Vitest's `test` that allows
// ONE logic retry for tests that are inherently nondeterministic (e.g.
// AI-agent runs whose output varies). It also logs a warning so the
// flakiness stays visible in CI / local output.
//
// Used sparingly — most AI tests should assert on structural properties
// that don't vary across runs. Reserve `flakyTest` for cases where the
// structure itself can legitimately differ between runs.
//
// Per the implementation plan §2 retry semantics:
//  - SDK transport errors retry once automatically inside the harness.
//  - Logic-failed assertions do NOT retry by default.
//  - flakyTest gets one logic retry but logs a warning.
export function flakyTest(name: string, fn: () => void | Promise<void>): void {
  test(name, { retry: 1 }, async (context) => {
    try {
      await fn();
    } catch (err) {
      // The first attempt failed; vitest will retry. Surface the warning
      // so the run output makes it obvious this test is flaky.
      console.warn(`[flaky] ${context.task.name} failed once, retrying.`);
      throw err;
    }
  });
}
