const viteEnv = import.meta.env || {};
export const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_BACKEND_PORT = "5507";
export const DEFAULT_STATIC_FRONTEND_PORT = "5507";
const backendPort = viteEnv.VITE_BACKEND_PORT || DEFAULT_BACKEND_PORT;
const staticFrontendPort = viteEnv.VITE_STATIC_PORT || DEFAULT_STATIC_FRONTEND_PORT;
const browser = typeof window === "undefined" ? null : window;

function resolveApiBaseUrl() {
  if (!browser) return "";

  const configuredBase = (viteEnv.VITE_API_BASE_URL || browser.NAVO_API_BASE_URL || "").trim();
  if (configuredBase) return configuredBase.replace(/\/+$/, "");

  if (browser.location.protocol === "file:") {
    return `http://${DEFAULT_BACKEND_HOST}:${backendPort}`;
  }

  const currentUrl = new URL(browser.location.origin);
  if (currentUrl.port === staticFrontendPort) {
    currentUrl.port = backendPort;
  }
  return currentUrl.origin;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_ORIGIN = browser ? new URL(API_BASE_URL || browser.location.origin).origin : "";

if (browser) {
  browser.NAVO_CONFIG = Object.freeze({
    API_BASE_URL,
    API_ORIGIN,
  });
}
