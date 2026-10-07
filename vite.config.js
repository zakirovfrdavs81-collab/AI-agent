import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT } from "./js/config.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendHost = env.VITE_BACKEND_HOST?.trim() || DEFAULT_BACKEND_HOST;
  const backendPort = env.VITE_BACKEND_PORT?.trim() || DEFAULT_BACKEND_PORT;
  const proxyTarget = env.VITE_API_BASE_URL?.trim() || `http://${backendHost}:${backendPort}`;

  return {
    base: "./",
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: proxyTarget,
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
