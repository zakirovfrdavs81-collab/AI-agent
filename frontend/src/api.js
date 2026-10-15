import { API_BASE_URL } from "../js/config.js";

export const apiBase = API_BASE_URL;

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}/api${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Serverga ulanib bo‘lmadi. Backend ishlayotganini tekshiring.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item?.msg || String(item)).join(", ")
        : detail?.message || detail?.msg || `Server xatosi (${response.status}).`;
    const error = new Error(message);
    if (Array.isArray(detail)) {
      error.validationErrors = detail
        .map((item) => ({
          field: Array.isArray(item?.loc) ? item.loc.join(".") : "",
          message: item?.msg || "",
        }))
        .filter((item) => item.field);
    }
    throw error;
  }
  return data;
}

export function post(path, body) {
  return apiRequest(path, { method: "POST", body: JSON.stringify(body) });
}
