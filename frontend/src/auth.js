import { apiBase, post } from "./api.js";

export const registerAccount = (details) => post("/auth/register", details);
export const loginAccount = (credentials) => post("/auth/login", credentials);
function requireOtpCode(verification) {
  const code = String(verification?.code || "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error("6 xonali tasdiqlash kodini kiriting.");
  }
  return { ...verification, code };
}

export const verifyOtp = (verification) => post("/auth/verify-otp", requireOtpCode(verification));
export const verifyLoginOtp = (verification) => post("/auth/verify-login-otp", requireOtpCode(verification));
export const resendOtp = (request) => post("/auth/resend-otp", request);
export const requestPasswordReset = (request) => post("/auth/forgot", request);
export const resetPassword = (request) => post("/auth/reset", request);
export const logoutAccount = () => post("/auth/logout", {});

export function startGoogleLogin() {
  window.location.assign(`${apiBase}/api/auth/google`);
}
