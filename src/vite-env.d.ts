/// <reference types="vite/client" />

// Vite's `?raw` import — markdown files inlined as strings at build time.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

// Vite's `?url` import — produce a runtime URL for an arbitrary asset.
// Phase 12 uses this for the .skill and .zip skill bundles so the
// renderer can fetch them and Tauri can write them to disk.
declare module "*.skill?url" {
  const url: string;
  export default url;
}

declare module "*.zip?url" {
  const url: string;
  export default url;
}
