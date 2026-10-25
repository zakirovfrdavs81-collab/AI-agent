import { useEffect, useState } from "react";

let deferredInstallPrompt = null;
const installPromptListeners = new Set();

function installPromptState() {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(window.navigator.userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(window.navigator.userAgent);
  return {
    canInstall: Boolean(deferredInstallPrompt) && !standalone,
    iosHint: ios && safari && !standalone,
  };
}

function notifyInstallPromptListeners() {
  for (const listener of installPromptListeners) listener(installPromptState());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    notifyInstallPromptListeners();
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .catch((error) => console.error("Service worker registration failed:", error));
  }, { once: true });
}

export function useInstallPrompt() {
  const [state, setState] = useState(installPromptState);

  useEffect(() => {
    installPromptListeners.add(setState);
    setState(installPromptState());
    return () => installPromptListeners.delete(setState);
  }, []);

  async function promptInstall() {
    if (!deferredInstallPrompt) return;
    const prompt = deferredInstallPrompt;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    deferredInstallPrompt = null;
    notifyInstallPromptListeners();
    return choice.outcome;
  }

  return { ...state, promptInstall };
}
