import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:5507";
const DEFAULT_PRODUCTION_API_URL = "https://ai-agent-1-d569.onrender.com";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL?.trim() || (
    mode === "development" ? DEFAULT_BACKEND_URL : DEFAULT_PRODUCTION_API_URL
  );

  return {
    base: "./",
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: apiUrl,
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
  };
});
