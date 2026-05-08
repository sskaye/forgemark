import { defineConfig } from "vitest/config";

// Vitest uses esbuild internally to handle JSX/TSX, so we don't need the
// @vitejs/plugin-react plugin here (which is the build-time HMR helper).
// Keeping this config plugin-free avoids a vite-version type conflict
// between vite and vitest's vendored vite.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: process.env.RUN_AI_TESTS ? [] : ["tests/ai/**"],
  },
});
