/// <reference types="vite/client" />

// Vite's `?raw` import — markdown files inlined as strings at build time.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
