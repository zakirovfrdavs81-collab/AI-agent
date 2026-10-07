import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT } from "./js/config.js";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
          return undefined;
        },
      },
    },
  },
});
