import { apiBase, post } from "./api.js";

export const registerAccount = (details) => post("/auth/register", details);
export const loginAccount = (credentials) => post("/auth/login", credentials);
export const verifyOtp = (verification) => post("/auth/verify-otp", verification);
export const verifyLoginOtp = (verification) => post("/auth/verify-login-otp", verification);
export const resendOtp = (request) => post("/auth/resend-otp", request);
export const requestPasswordReset = (request) => post("/auth/forgot", request);
export const resetPassword = (request) => post("/auth/reset", request);
export const logoutAccount = () => post("/auth/logout", {});

export function startGoogleLogin() {
  window.location.assign(`${apiBase}/api/auth/google`);
}
