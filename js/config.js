export const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_BACKEND_PORT = "5507";
const browser = typeof window === "undefined" ? null : window;

export const API_BASE_URL = `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;
export const API_ORIGIN = API_BASE_URL;

if (browser) {
  browser.NAVO_CONFIG = Object.freeze({
    API_BASE_URL,
    API_ORIGIN,
  });
}
