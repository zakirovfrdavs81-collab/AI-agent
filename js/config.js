const browser = typeof window === "undefined" ? null : window;

export const API_BASE_URL = "";
export const API_ORIGIN = browser ? browser.location.origin : "";

if (browser) {
  browser.NAVO_CONFIG = Object.freeze({
    API_BASE_URL,
    API_ORIGIN,
  });
}
