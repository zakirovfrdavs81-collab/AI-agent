import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPortListeners } from "./port.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellCommand = process.platform === "win32" ? "cmd" : "sh";
const shellArgs = process.platform === "win32" ? ["/c", "npm run build"] : ["-lc", "npm run build"];
const devPort = Number(process.env.PORT || 5507);
const devHost = process.env.HOST || "0.0.0.0";
const loopbackHost = devHost === "0.0.0.0" ? "127.0.0.1" : devHost;
const appUrl = process.env.APP_ORIGIN
  ? `${process.env.APP_ORIGIN.replace(/\/+$/, "")}/`
  : `http://${loopbackHost}:${devPort}/`;
const frontendEntry = path.join(projectRoot, "frontend", "index.html");
const frontendBuildIndex = path.join(projectRoot, "frontend", "dist", "index.html");
const frontendBuildAssets = path.join(projectRoot, "frontend", "dist", "assets");
const openBrowser = process.argv.includes("--open-browser");

function findChrome() {
  if (process.platform !== "win32") {
    return "google-chrome";
  }

  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function appIsReady() {
  try {
    const [healthRes, apiHealthRes] = await Promise.all([
      fetch(`${appUrl}health`, { signal: AbortSignal.timeout(1500) }).catch(() => null),
      fetch(`${appUrl}api/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null),
    ]);

    const activeRes = (healthRes && healthRes.ok) ? healthRes : ((apiHealthRes && apiHealthRes.ok) ? apiHealthRes : null);
    if (!activeRes) return false;

    const data = await activeRes.json().catch(() => null);
    if (!data || data.status !== "ok") return false;

    try {
      const configRes = await fetch(`${appUrl}api/config`, { signal: AbortSignal.timeout(1500) });
      if (configRes.ok) {
        const config = await configRes.json();
        if (typeof config.google_login === "boolean" || typeof config.email_channel === "string") {
          return true;
        }
      }
    } catch {
      // config tekshiruvi xato bo'lsa ham health ok bo'lsa kifoya
    }
    return true;
  } catch {
    return false;
  }
}

function openChrome() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("Google Chrome was not found in the standard Windows installation paths.");
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const browser = spawn(chrome, [appUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    browser.once("error", (error) => {
      console.error(`Could not open Google Chrome: ${error.message}`);
      resolve(false);
    });
    browser.once("spawn", () => {
      browser.unref();
      console.log(`Opened Google Chrome at ${appUrl}`);
      resolve(true);
    });
  });
}

async function runBuildAndStart() {
  if (existsSync(frontendEntry)) {
    const buildCode = await new Promise((resolve, reject) => {
      const build = spawn(shellCommand, shellArgs, {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(devPort), HOST: devHost },
        stdio: "inherit",
      });

      build.once("error", reject);
      build.once("exit", (code) => resolve(code ?? 1));
    });
    if (buildCode !== 0) {
      throw new Error(`Frontend build failed with exit code ${buildCode}.`);
    }
  } else if (existsSync(frontendBuildIndex) && existsSync(frontendBuildAssets)) {
    console.warn(
      "frontend/index.html is absent; using the existing frontend/dist build without rebuilding it.",
    );
  } else {
    throw new Error("Cannot build the frontend or serve it: frontend/index.html and frontend/dist are missing.");
  }

  const listeners = await getPortListeners(devPort, loopbackHost);
  if (listeners.length) {
    if (!(await appIsReady())) {
      const pidText = listeners.filter(Boolean).join(", ") || "aniqlanmadi";
      console.error(
        `XATO: ${devPort}-port band, lekin unda Navo AI FastAPI aniqlanmadi.\n` +
        `Tinglayotgan jarayon PID: ${pidText}.\n` +
        `Boshqa dastur (masalan, Live Server) ${devPort}-portni band qilib turibdi.\n` +
        `Ushbu jarayonni to'xtating yoki portni bo'shatib, qayta urinib ko'ring.`
      );
      process.exitCode = 1;
      return;
    }
    if (new Set(listeners).size > 1) {
      console.error(
        `Port ${devPort} has multiple listening processes. Refusing to start another server.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Navo AI FastAPI allaqachon ishlayapti: ${appUrl}`);
    if (openBrowser && !(await openChrome())) process.exitCode = 1;
    return;
  }

  const listenersAfterBuild = await getPortListeners(devPort, loopbackHost);
  if (listenersAfterBuild.length) {
    if (!(await appIsReady())) {
      const pidText = listenersAfterBuild.filter(Boolean).join(", ") || "aniqlanmadi";
      throw new Error(
        `XATO: ${devPort}-port build jarayonida boshqa dastur tomonidan band qilindi. Tinglayotgan jarayon PID: ${pidText}.`
      );
    }
    if (new Set(listenersAfterBuild).size > 1) {
      throw new Error(`Port ${devPort} has multiple listening processes; refusing to start another server.`);
    }
    console.log(`Navo AI FastAPI allaqachon ishlayapti: ${appUrl}`);
    if (openBrowser && !(await openChrome())) process.exitCode = 1;
    return;
  }

  startBackend(openBrowser);
}

function startBackend(waitForReady = false) {
    const forwardedAllowIps = process.env.FORWARDED_ALLOW_IPS || "*";
    const backend = spawn(process.execPath, [path.join(projectRoot, "scripts", "start.js")], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOST: devHost,
        PORT: String(devPort),
        FORWARDED_ALLOW_IPS: forwardedAllowIps,
      },
      stdio: "inherit",
    });
    let backendExit = null;

    backend.on("error", (error) => {
      console.error(`Backend failed to start: ${error.message}`);
      process.exitCode = 1;
    });

    backend.on("exit", (exitCode, signal) => {
      backendExit = exitCode ?? (signal ? 1 : 0);
      process.exitCode = backendExit;
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => backend.kill(signal));
    }

    if (waitForReady) {
      waitForBackend(backend, () => backendExit).catch((error) => {
        console.error(error.message);
        backend.kill();
        process.exitCode = 1;
      });
    }
}

async function waitForBackend(backend, getExitCode) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (getExitCode() !== null) {
      throw new Error(`FastAPI stopped before it became ready (exit code ${getExitCode()}).`);
    }
    if (await appIsReady()) {
      if (!(await openChrome())) process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  backend.kill();
  throw new Error(`FastAPI did not become ready at ${appUrl} within 30 seconds.`);
}

runBuildAndStart().catch((error) => {
  console.error(`Could not start Go Live workflow: ${error.message}`);
  process.exitCode = 1;
});
