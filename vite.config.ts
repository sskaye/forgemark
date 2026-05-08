import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  // Phase 12: treat .skill / .zip as static assets so the
  // `?url` imports in src/services/skillDownload.ts resolve to
  // bundled files at runtime.
  assetsInclude: ["**/*.skill", "**/*.zip"],

  // Vite settings tuned for Tauri dev
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
