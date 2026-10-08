export const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_BACKEND_PORT = "5507";
export const DEFAULT_PRODUCTION_API_URL = "https://ai-agent-1-d569.onrender.com";
const browser = typeof window === "undefined" ? null : window;

const localApiUrl = `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;
const configuredApiUrl = (import.meta.env.VITE_API_URL || "").trim();
export const API_BASE_URL = (
  configuredApiUrl ||
  (import.meta.env.PROD ? DEFAULT_PRODUCTION_API_URL : localApiUrl)
).replace(/\/+$/, "");
export const API_ORIGIN = API_BASE_URL;

if (browser) {
  browser.NAVO_CONFIG = Object.freeze({
    API_BASE_URL,
    API_ORIGIN,
  });
}
