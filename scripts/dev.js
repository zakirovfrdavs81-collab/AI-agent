import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPortListeners } from "./port.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellCommand = process.platform === "win32" ? "cmd" : "sh";
const shellArgs = process.platform === "win32" ? ["/c", "npm run build"] : ["-lc", "npm run build"];
const appUrl = "http://127.0.0.1:5507/";
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
    const [healthResponse, pageResponse, appPageResponse, configResponse] = await Promise.all([
      fetch(`${appUrl}api/health`, { signal: AbortSignal.timeout(1000) }),
      fetch(appUrl, { signal: AbortSignal.timeout(1000) }),
      fetch(`${appUrl}app/`, { signal: AbortSignal.timeout(1000) }),
      fetch(`${appUrl}api/config`, { signal: AbortSignal.timeout(1000) }),
    ]);
    if (!healthResponse.ok || !pageResponse.ok || !appPageResponse.ok || !configResponse.ok) return false;
    const [health, page, appPage, config] = await Promise.all([
      healthResponse.json(),
      pageResponse.text(),
      appPageResponse.text(),
      configResponse.json(),
    ]);
    return health.status === "ok"
      && page.includes('<title>Navo AI')
      && page.includes('data-nav')
      && appPage.includes('id="root"')
      && typeof config.google_login === "boolean"
      && typeof config.email_channel === "string";
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
        env: { ...process.env, PORT: "5507", HOST: "127.0.0.1" },
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

  const listeners = await getPortListeners(5507);
  if (listeners.length) {
    if (!(await appIsReady())) {
      console.error(
        "Port 5507 is occupied by a server that is not the expected Navo AI FastAPI app. Stop it only after verifying its owner, then run this task again.",
      );
      process.exitCode = 1;
      return;
    }
    if (new Set(listeners).size > 1) {
      console.error(
        "Port 5507 has multiple listening processes. Refusing to start another server.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Navo AI FastAPI is already running at ${appUrl}`);
    if (openBrowser && !(await openChrome())) process.exitCode = 1;
    return;
  }

  const listenersAfterBuild = await getPortListeners(5507);
  if (listenersAfterBuild.length) {
    if (!(await appIsReady())) {
      throw new Error("Port 5507 became occupied by a server that is not this FastAPI app during the build.");
    }
    if (new Set(listenersAfterBuild).size > 1) {
      throw new Error("Port 5507 has multiple listening processes; refusing to start another server.");
    }
    console.log(`Navo AI FastAPI is already running at ${appUrl}`);
    if (openBrowser && !(await openChrome())) process.exitCode = 1;
    return;
  }

  startBackend(openBrowser);
}

function startBackend(waitForReady = false) {
    const backend = spawn(process.execPath, [path.join(projectRoot, "scripts", "start.js")], {
      cwd: projectRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: "5507" },
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
