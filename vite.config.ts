import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  define: {
    __SPATIAL_E2E__: JSON.stringify(mode === "test"),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        viewer: resolve(import.meta.dirname, "index.html"),
        studio: resolve(import.meta.dirname, "studio.html"),
        renderer: resolve(import.meta.dirname, "renderer/index.html"),
      },
    },
  },
}));
