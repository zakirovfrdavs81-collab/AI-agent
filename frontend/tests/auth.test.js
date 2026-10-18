import assert from "node:assert/strict";
import { test } from "node:test";

const navigations = [];
globalThis.window = {
  location: {
    origin: "https://ai-agent-1-ef3i.onrender.com",
    assign: (url) => navigations.push(url),
  },
};

const { googleLoginUrl, startGoogleLogin } = await import("../src/auth.js");

test("Google OAuth endpoint is /api/auth/google on the current origin", () => {
  assert.equal(googleLoginUrl(), "/api/auth/google");
  assert.equal(
    new URL(googleLoginUrl(), window.location.origin).href,
    "https://ai-agent-1-ef3i.onrender.com/api/auth/google",
  );
});

test("Google login click redirects to the backend OAuth endpoint", () => {
  startGoogleLogin();

  assert.deepEqual(navigations, ["/api/auth/google"]);
});
